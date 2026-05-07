import type { BaseMessage } from '@langchain/core/messages';
import { END } from '@langchain/langgraph';

/**
 * Conditional edge from chat_node. If the last assistant message has any
 * `tool_calls`, route to `tool_node`; else end.
 *
 * We deliberately duck-type the message here rather than using
 * `instanceof AIMessage`. Both `@langchain/core` and `@langchain/langgraph`
 * pull in their own copies of the message classes, and when LangGraph's
 * `MessagesAnnotation` rehydrates state across the graph boundary the
 * resulting object is an `AIMessage` *value* whose prototype no longer
 * matches the import we'd compare against — so `instanceof` returns
 * `false` and the graph would terminate after every first turn even when
 * the LLM clearly wanted to call a tool.
 */
export function routeToToolNode(state: {
  messages: BaseMessage[];
}): 'tool_node' | typeof END {
  const last = state.messages[state.messages.length - 1] as unknown as {
    _getType?: () => string;
    tool_calls?: Array<{ name?: string }>;
  };
  const isAi = last?._getType?.() === 'ai';
  const toolCalls = last?.tool_calls ?? [];
  if (isAi && toolCalls.length > 0) {
    return 'tool_node';
  }
  return END;
}
