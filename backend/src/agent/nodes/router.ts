import type { BaseMessage } from '@langchain/core/messages';
import { AIMessage } from '@langchain/core/messages';
import { END } from '@langchain/langgraph';

/**
 * Conditional edge from chat_node. Mirrors the Python router:
 * if the last assistant message has tool_calls, route to tool_node; else end.
 */
export function routeToToolNode(state: {
  messages: BaseMessage[];
}): 'tool_node' | typeof END {
  const last = state.messages[state.messages.length - 1];
  if (
    last instanceof AIMessage &&
    last.tool_calls &&
    last.tool_calls.length > 0
  ) {
    return 'tool_node';
  }
  return END;
}
