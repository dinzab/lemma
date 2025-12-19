from typing import Literal
from state import AgentState

def route_to_tool_node(state: AgentState) -> Literal["tool_node", "__end__"]:
    """
    Determines the next node based on the last message.
    If the last message has tool calls, route to 'tool_node'.
    Otherwise, route to END.
    """
    last_message = state["messages"][-1]
    
    if hasattr(last_message, "tool_calls") and len(last_message.tool_calls) > 0:
        return "tool_node"
    
    return "__end__"
