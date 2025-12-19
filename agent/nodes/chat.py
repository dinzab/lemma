from langchain_core.messages import SystemMessage
from model import get_model
from tools import backend_tools
from system_prompt import get_system_prompt
from state import AgentState

def chat_node(state: AgentState):
    """
    Standard chat node based on the ReAct design pattern.
    """
    
    # 1. Get the model (defaults to OpenRouter)
    model = get_model()

    # 2. Bind backend tools only (CopilotKit removed)
    model_with_tools = model.bind_tools(
        backend_tools,
        parallel_tool_calls=False,
    )

    # 3. Define system message
    system_message = SystemMessage(
        content=get_system_prompt()
    )

    # 4. Invoke model
    response = model_with_tools.invoke(
        [system_message, *state["messages"]]
    )

    # 5. Return update
    return {"messages": [response]}
