/**
 * Manual end-to-end smoke for the agent — drives one full chat turn
 * synchronously and prints the message log so we can verify the LLM
 * loops chat → tool → chat → final answer correctly.
 *
 *   npx ts-node --transpile-only scripts/smoke-agent-invoke.ts
 *
 * Live network calls (NIM + Qdrant + Neo4j); not part of the unit suite.
 */

import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { CheckpointerService } from '../src/agent/checkpointer.service';
import { LlmService } from '../src/agent/llm.service';
import { AgentToolsService } from '../src/agent/tools';
import { buildGraph } from '../src/agent/graph';
import { HumanMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const llm = app.get(LlmService);
  const tools = app.get(AgentToolsService).getAll();
  const checkpointer = app.get(CheckpointerService);
  const graph = buildGraph({
    buildModel: () => llm.getChatModel(),
    tools,
    checkpointer: checkpointer.saver,
  });

  const threadId = `smoke-invoke-${Date.now()}`;
  const out = await graph.invoke(
    {
      messages: [
        new HumanMessage(
          "I'm prepping for the Bac math controle. How many " +
            'arithmetic questions about PGCD do you have, and can you ' +
            'show me one with its full solution?',
        ),
      ],
    },
    {
      configurable: { thread_id: threadId },
      recursionLimit: 12,
    },
  );

  const messages = (out as { messages: BaseMessage[] }).messages;
  console.log(`message count: ${messages.length}`);
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i] as {
      content: unknown;
      tool_calls?: Array<{ name: string; args: unknown }>;
      _getType?: () => string;
    };
    const t = m._getType ? m._getType() : 'unknown';
    if (m.tool_calls?.length) {
      const calls = m.tool_calls
        .map((tc) => `${tc.name}(${JSON.stringify(tc.args)})`)
        .join(', ');
      console.log(`\n[${i}] ${t} TOOL_CALLS: ${calls}`);
    }
    if (typeof m.content === 'string' && m.content) {
      const preview =
        m.content.length > 400 ? `${m.content.slice(0, 400)}…` : m.content;
      console.log(`[${i}] ${t}: ${preview}`);
    }
  }

  await app.close();
}

main().catch((err) => {
  console.error('SMOKE FAILED:', err);
  process.exit(1);
});
