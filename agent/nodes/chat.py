import logging

from langchain_core.messages import AIMessage, SystemMessage

from model import get_model
from state import AgentState
from system_prompt import get_system_prompt
from tools import backend_tools

logger = logging.getLogger(__name__)


def chat_node(state: AgentState):
    """
    Standard chat node based on the ReAct design pattern.

    Wraps the LLM call so that any provider/network failure surfaces as a
    visible assistant message instead of killing the AG-UI stream mid-flight
    (which the frontend perceives as a "freeze").
    """

    try:
        model = get_model()
        model_with_tools = model.bind_tools(
            backend_tools,
            parallel_tool_calls=False,
        )

        system_message = SystemMessage(content=get_system_prompt())

        response = model_with_tools.invoke(
            [system_message, *state["messages"]]
        )
        return {"messages": [response]}
    except Exception as exc:  # pragma: no cover - defensive
        # Log full diagnostic context server-side, but never echo provider
        # internals (model ids, base URLs, HTTP bodies, connection strings)
        # back to the end user.
        logger.exception("chat_node failed: %s", exc)
        return {
            "messages": [
                AIMessage(
                    content=(
                        "⚠️ The tutor is temporarily unavailable. "
                        "Please retry in a moment, and if the problem persists "
                        "ask an administrator to verify the LLM credentials."
                    )
                )
            ]
        }
