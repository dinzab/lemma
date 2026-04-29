import {
  END,
  MessagesAnnotation,
  START,
  StateGraph,
} from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { ChatOpenAI } from '@langchain/openai';
import { makeChatNode } from './nodes/chat.node';
import { routeToToolNode } from './nodes/router';

/**
 * Compile the ReAct chat ↔ tools graph against a checkpoint saver.
 * Equivalent of `agent/graph.py` in the FastAPI service.
 */
export function buildGraph(opts: {
  buildModel: () => ChatOpenAI;
  tools: StructuredToolInterface[];
  checkpointer: BaseCheckpointSaver;
}) {
  const { buildModel, tools, checkpointer } = opts;

  const workflow = new StateGraph(MessagesAnnotation)
    .addNode('chat_node', makeChatNode(buildModel, tools))
    .addNode('tool_node', new ToolNode(tools))
    .addEdge(START, 'chat_node')
    .addConditionalEdges('chat_node', routeToToolNode, {
      tool_node: 'tool_node',
      [END]: END,
    })
    .addEdge('tool_node', 'chat_node');

  return workflow.compile({ checkpointer });
}

export type CompiledAgentGraph = ReturnType<typeof buildGraph>;
