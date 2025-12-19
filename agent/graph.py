import os
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode
from langgraph.checkpoint.memory import MemorySaver
from state import AgentState
from nodes.chat import chat_node
from nodes.router import route_to_tool_node
from tools import backend_tools
from langgraph.checkpoint.postgres import PostgresSaver
# 1. Define the graph
workflow = StateGraph(AgentState)

# 2. Add nodes
workflow.add_node("chat_node", chat_node)
workflow.add_node("tool_node", ToolNode(backend_tools))

# 3. Define edges
workflow.set_entry_point("chat_node")

# Conditional edge from chat_node to tool_node or END
workflow.add_conditional_edges(
    "chat_node",
    route_to_tool_node,
    {
        "tool_node": "tool_node",
        "__end__": END
    }
)

# Edge from tool_node back to chat_node
workflow.add_edge("tool_node", "chat_node")

# 4. Export the workflow and a helper to setup the checkpointer
def get_async_checkpointer():
    """
    Get the appropriate async checkpointer based on environment.
    Uses AsyncPostgresSaver when POSTGRES_URI is available (production/Docker),
    otherwise falls back to MemorySaver for local development.
    """
    postgres_uri = os.getenv("POSTGRES_URI")
    
    if postgres_uri:
        from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
        return AsyncPostgresSaver.from_conn_string(postgres_uri)
    else:
        print("ℹ️ POSTGRES_URI not set, using MemorySaver (state will not persist)")
        return MemorySaver()

# NOTE: We do NOT compile the graph here anymore.
# The server will compile it with the async checkpointer during startup.

