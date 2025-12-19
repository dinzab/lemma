"""
AG-UI Protocol Server for LangGraph Agent

This is the main entry point that exposes the LangGraph agent via the AG-UI protocol.
It uses FastAPI with the ag-ui-langgraph integration.
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from ag_ui_langgraph import LangGraphAgent, add_langgraph_fastapi_endpoint
from graph import workflow, get_async_checkpointer
from langgraph.checkpoint.memory import MemorySaver
import uvicorn
import os

# Global variables to hold the compiled graph and agent
graph = None
agent = None
checkpointer_pool = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Manage the lifecycle of the application:
    1. Initialize the async checkpointer (create connection pool)
    2. Compile the graph with the checkpointer
    3. Initialize the LangGraphAgent
    4. Clean up resources on shutdown
    """
    global graph, agent, checkpointer_pool
    
    # helper returns context manager for postgres, or just MemorySaver instance
    cp_result = get_async_checkpointer()
    
    if isinstance(cp_result, MemorySaver):
        # MemorySaver is synchronous and simple
        print("Using MemorySaver (in-memory)")
        checkpointer = cp_result
        graph = workflow.compile(checkpointer=checkpointer)
    else:
        # AsyncPostgresSaver returns an AsyncConnectionManager
        print("Initializing PostgreSQL connection pool...")
        checkpointer_pool = cp_result
        checkpointer = await checkpointer_pool.__aenter__()
        
        # Setup tables if needed
        await checkpointer.setup()
        
        graph = workflow.compile(checkpointer=checkpointer)
        print("✅ Graph compiled with AsyncPostgresSaver")

    # Wrap with LangGraphAgent for AG-UI
    # We create a new instance here, but since add_langgraph_fastapi_endpoint 
    # was already called (see below), we need to be careful.
    # Actually, add_langgraph_fastapi_endpoint needs 'agent' instance.
    # We'll update the global 'agent' variable which the endpoint routes use.
    # However, standard FastAPI routing doesn't support 'lazy' objects easily.
    
    # Solution: We initialize a wrapper or proxy, OR we define routes inside lifespan?
    # Better: We use the 'agent' object which is modified in place? No, LangGraphAgent is immutable-ish.
    
    # Simplest approach for now:
    # 1. Compile graph here.
    # 2. Assign to global 'agent'.
    # 3. BUT add_langgraph_fastapi_endpoint is called at module level usually.
    
    # Let's fix this by constructing the app dynamically?
    # No, that breaks uvicorn entrypoint usually unless we use factory.
    
    # Let's manually setup the agent here and then add the routes using the app instance.
    agent = LangGraphAgent(graph=graph, name="bacprep_agent")
    
    # We need to re-add the endpoint because it was likely added with a None agent or we didn't call it yet.
    # Let's call add_langgraph_fastapi_endpoint INSIDE lifespan? 
    # No, routes must be added before startup usually, but FastAPI supports adding routes later (though not recommended).
    
    # ACTUALLY: ag-ui-langgraph's add_langgraph_fastapi_endpoint takes the agent.
    # If we call it here, it will work.
    add_langgraph_fastapi_endpoint(app, agent, "/agent")
    
    yield
    
    # Cleanup
    if checkpointer_pool:
        print("Closing PostgreSQL connection pool...")
        await checkpointer_pool.__aexit__(None, None, None)

# Create FastAPI app with lifespan
app = FastAPI(
    title="BacPrep AI Agent",
    description="Tunisian Baccalaureate AI Tutor Agent using AG-UI Protocol",
    version="1.0.0",
    lifespan=lifespan
)

# Configure CORS for frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://frontend:3000",
        os.getenv("FRONTEND_URL", "http://localhost:3000"),
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Health check endpoint
@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "agent": "BacPrep AI",
        "protocol": "AG-UI",
        "persistence": "PostgreSQL" if checkpointer_pool else "Memory"
    }

# Root endpoint
@app.get("/")
async def root():
    return {
        "message": "BacPrep AI Agent is running",
        "docs": "/docs",
        "agent_endpoint": "/agent"
    }

# ============================================================================
# Thread State Endpoint - Fetch messages from LangGraph checkpoint
# ============================================================================

@app.get("/threads/{thread_id}/state")
async def get_thread_state(thread_id: str):
    """
    Get the current state of a thread, including message history.
    This fetches the state from the LangGraph checkpointer.
    """
    if not graph:
        raise HTTPException(status_code=503, detail="Agent uninitialized")

    try:
        config = {"configurable": {"thread_id": thread_id}}
        
        # Use aget_state for async graph/checkpointer
        state = await graph.aget_state(config)
        
        if state is None or state.values is None:
            # Thread doesn't exist yet - return empty state
            return {
                "thread_id": thread_id,
                "exists": False,
                "messages": [],
                "values": {}
            }
        
        # Extract messages from state
        messages = state.values.get("messages", [])
        
        # Convert LangChain messages to simple dict format
        formatted_messages = []
        for msg in messages:
            # Handle both dict-style and LangChain message objects
            if hasattr(msg, "content"):
                formatted_msg = {
                    "id": getattr(msg, "id", None) or str(hash(msg.content))[:8],
                    "role": msg.type if hasattr(msg, "type") else (
                        "user" if msg.__class__.__name__ == "HumanMessage" else "assistant"
                    ),
                    "content": msg.content
                }
                # Add tool_call_id for ToolMessages
                if hasattr(msg, "tool_call_id") and msg.tool_call_id:
                    formatted_msg["tool_call_id"] = msg.tool_call_id
                # Add name for ToolMessages
                if hasattr(msg, "name") and msg.name:
                    formatted_msg["name"] = msg.name
                # Add tool_calls for AIMessages
                if hasattr(msg, "tool_calls") and msg.tool_calls:
                    formatted_msg["tool_calls"] = [
                        {
                            "id": tc.get("id") if isinstance(tc, dict) else getattr(tc, "id", None),
                            "name": tc.get("name") if isinstance(tc, dict) else getattr(tc, "name", None),
                            "args": tc.get("args") if isinstance(tc, dict) else getattr(tc, "args", {}),
                        }
                        for tc in msg.tool_calls
                    ]
                formatted_messages.append(formatted_msg)
            elif isinstance(msg, dict):
                formatted_msg = {
                    "id": msg.get("id", str(hash(str(msg.get("content", ""))))[:8]),
                    "role": msg.get("role") or msg.get("type", "user"),
                    "content": msg.get("content", "")
                }
                if msg.get("tool_call_id"):
                    formatted_msg["tool_call_id"] = msg["tool_call_id"]
                if msg.get("name"):
                    formatted_msg["name"] = msg["name"]
                if msg.get("tool_calls"):
                    formatted_msg["tool_calls"] = msg["tool_calls"]
                formatted_messages.append(formatted_msg)
        
        return {
            "thread_id": thread_id,
            "exists": True,
            "messages": formatted_messages,
            "values": state.values,
            "checkpoint_id": state.config.get("configurable", {}).get("checkpoint_id") if state.config else None
        }
        
    except Exception as e:
        # Log the error but return empty state rather than erroring
        print(f"Error fetching thread state for {thread_id}: {e}")
        return {
            "thread_id": thread_id,
            "exists": False,
            "messages": [],
            "error": str(e)
        }

@app.delete("/threads/{thread_id}")
async def delete_thread(thread_id: str):
    return {
        "thread_id": thread_id,
        "message": "Thread clear requested. New messages will start fresh."
    }

if __name__ == "__main__":
    port = int(os.getenv("PORT", "8123"))
    uvicorn.run(app, host="0.0.0.0", port=port)
