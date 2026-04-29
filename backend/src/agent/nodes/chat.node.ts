import { Logger } from '@nestjs/common';
import { AIMessage, SystemMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { ChatOpenAI } from '@langchain/openai';
import { getSystemPrompt } from '../system-prompt';

const logger = new Logger('chat_node');

const FALLBACK_USER_MESSAGE =
  '⚠️ The tutor is temporarily unavailable. Please retry in a moment, and ' +
  'if the problem persists ask an administrator to verify the LLM credentials.';

/**
 * Build the ReAct chat node — wraps the LLM call so failures surface as a
 * visible AIMessage instead of crashing the LangGraph step (and freezing the
 * AG-UI / Vercel AI stream mid-flight).
 *
 * The exception itself is logged with full context server-side, but the
 * user-facing message is intentionally generic to avoid leaking model ids,
 * base URLs, or HTTP bodies (Devin Review item from PR #1).
 */
export function makeChatNode(
  buildModel: () => ChatOpenAI,
  tools: StructuredToolInterface[],
) {
  return async function chatNode(state: {
    messages: BaseMessage[];
  }): Promise<{ messages: BaseMessage[] }> {
    try {
      const model = buildModel();
      const modelWithTools = model.bindTools(tools, {
        parallel_tool_calls: false,
      });
      const systemMessage = new SystemMessage(getSystemPrompt());
      const response = await modelWithTools.invoke([
        systemMessage,
        ...state.messages,
      ]);
      return { messages: [response] };
    } catch (exc) {
      logger.error(`chat_node failed: ${String(exc)}`, (exc as Error).stack);
      return {
        messages: [new AIMessage({ content: FALLBACK_USER_MESSAGE })],
      };
    }
  };
}
