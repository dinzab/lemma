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

/** Max characters of the upstream provider's `error` body we serialise into
 * the log line. NIM error payloads are usually short, but a malformed
 * tool-call echo or a streamed-back validation report can be a few KB — cap
 * so a single failure can't blow up the log volume. */
const PROVIDER_ERROR_BODY_LOG_CAP = 2000;

/**
 * Pull the diagnostic surface off an OpenAI-SDK `APIError`-shaped object
 * without crashing on shapes we don't expect (network errors, AbortError,
 * plain `Error`, etc.). Returns a short, single-line summary suitable for a
 * Nest logger — falls back to `String(exc)` when the value isn't an API
 * error.
 *
 * Why a dedicated formatter: the chat-completions client only puts the
 * provider's authoritative reason on the SDK `APIError`'s `error` /
 * `param` / `code` / `type` / `requestID` fields, NOT on `error.message`.
 * `error.message` is just `"<status> <provider_message>"` (e.g. `"400
 * Param Incorrect"`) — a generic NIM phrasing that hides which parameter
 * is actually rejected. Logging `String(exc)` therefore loses the only
 * useful piece of debugging info on a 4xx response.
 */
function describeLlmError(exc: unknown): string {
  if (exc === null || typeof exc !== 'object') return String(exc);
  const e = exc as {
    name?: unknown;
    message?: unknown;
    status?: unknown;
    code?: unknown;
    param?: unknown;
    type?: unknown;
    requestID?: unknown;
    error?: unknown;
  };
  // OpenAI SDK shape: `status` is a number; AbortError / generic Error
  // won't have it. Fall back to `String(exc)` in that case so we never
  // hide non-API errors behind a sparse diagnostic line.
  if (typeof e.status !== 'number') return String(exc);

  const parts: string[] = [];
  parts.push(`status=${e.status}`);
  if (typeof e.name === 'string') parts.push(`name=${e.name}`);
  if (e.code !== undefined && e.code !== null)
    parts.push(`code=${String(e.code)}`);
  if (e.type !== undefined && e.type !== null)
    parts.push(`type=${String(e.type)}`);
  if (e.param !== undefined && e.param !== null)
    parts.push(`param=${String(e.param)}`);
  if (typeof e.requestID === 'string') parts.push(`requestID=${e.requestID}`);
  if (typeof e.message === 'string') parts.push(`message=${e.message}`);
  if (e.error !== undefined) {
    let body: string;
    try {
      body = typeof e.error === 'string' ? e.error : JSON.stringify(e.error);
    } catch {
      body = String(e.error);
    }
    if (body.length > PROVIDER_ERROR_BODY_LOG_CAP) {
      body = `${body.slice(0, PROVIDER_ERROR_BODY_LOG_CAP)}…(truncated)`;
    }
    parts.push(`error=${body}`);
  }
  return parts.join(' ');
}

/**
 * Build the ReAct chat node — wraps the LLM call so failures surface as a
 * visible AIMessage instead of crashing the LangGraph step (and freezing the
 * AG-UI / Vercel AI stream mid-flight).
 *
 * The exception itself is logged with full context server-side (status,
 * code, param, type, request id, and the upstream provider's `error` body
 * — capped at {@link PROVIDER_ERROR_BODY_LOG_CAP} chars), but the
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
      logger.error(
        `chat_node failed: ${describeLlmError(exc)}`,
        (exc as Error).stack,
      );
      return {
        messages: [new AIMessage({ content: FALLBACK_USER_MESSAGE })],
      };
    }
  };
}

export const __testing = { describeLlmError };
