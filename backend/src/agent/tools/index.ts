import { Injectable, Logger } from '@nestjs/common';
import { tool } from '@langchain/core/tools';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { QdrantClientProvider } from './qdrant.client';
import { Neo4jClientProvider } from './neo4j.client';
import { EmbeddingsClient } from './embeddings.client';

/**
 * AgentToolsService — exposes the three RAG tools the chat node binds onto
 * the LLM. Same contracts as `agent/tools.py`:
 *
 *   - search_vectors(query, limit=5)        → Qdrant semantic search
 *   - query_exam_graph(year?, session?, ...) → Neo4j metadata filter
 *   - get_content_by_id(doc_id)              → Qdrant scroll for full content
 *
 * Each tool catches its own errors and returns a JSON / human string so a
 * misconfigured Qdrant or Neo4j only degrades the affected tool, not the
 * whole stream. The chat node's outer try/catch is the second line of
 * defence for everything else.
 */
@Injectable()
export class AgentToolsService {
  private readonly logger = new Logger(AgentToolsService.name);

  constructor(
    private readonly qdrant: QdrantClientProvider,
    private readonly neo4j: Neo4jClientProvider,
    private readonly embeddings: EmbeddingsClient,
  ) {}

  getAll(): StructuredToolInterface[] {
    return [
      this.searchVectorsTool(),
      this.queryExamGraphTool(),
      this.getContentByIdTool(),
    ];
  }

  private searchVectorsTool(): StructuredToolInterface {
    return tool(
      async ({ query, limit }) => {
        try {
          const vector = await this.embeddings.embed(query);
          const points = await this.qdrant.query({
            vector,
            limit: limit ?? 5,
          });
          const formatted = points.map((p) => {
            const payload = (p.payload ?? {}) as Record<string, unknown>;
            const text = typeof payload.text === 'string' ? payload.text : '';
            return {
              doc_id: payload.doc_id ?? null,
              text: text.slice(0, 500) + (text.length > 500 ? '...' : ''),
              year: payload.year ?? null,
              session: payload.session ?? null,
              section: payload.section ?? null,
              subject: payload.subject ?? null,
              topic: payload.topic ?? null,
              type: payload.type ?? null,
              score: p.score,
            };
          });
          return JSON.stringify(formatted);
        } catch (err) {
          this.logger.warn(`search_vectors failed: ${String(err)}`);
          return `Error searching vectors: ${(err as Error).message}`;
        }
      },
      {
        name: 'search_vectors',
        description:
          'Queries Qdrant for semantic matches to find exercises by concept ' +
          'or description. Useful for finding relevant exercises based on a ' +
          'natural language query.',
        schema: z.object({
          query: z
            .string()
            .describe(
              'Natural language query (e.g., "complex numbers problems involving modulus")',
            ),
          limit: z
            .number()
            .int()
            .optional()
            .describe('Maximum number of results to return (default: 5)'),
        }),
      },
    );
  }

  private queryExamGraphTool(): StructuredToolInterface {
    return tool(
      async ({ year, session, section, subject, topic, limit }) => {
        let neo4jSession;
        try {
          const driver = this.neo4j.require();
          const conditions: string[] = [];
          const params: Record<string, unknown> = { limit: limit ?? 10 };

          if (year !== undefined && year !== null) {
            conditions.push('exam.year = $year');
            params.year = year;
          }
          if (session) {
            conditions.push('exam.session = $session');
            params.session = session;
          }
          if (section) {
            conditions.push('exam.section = $section');
            params.section = section;
          }
          if (subject) {
            conditions.push('exam.subject = $subject');
            params.subject = subject;
          }

          const where = conditions.length ? conditions.join(' AND ') : '1=1';

          let cypher: string;
          if (topic) {
            cypher = `
              MATCH (exam:Exam)-[:CONTAINS]->(exercise:Exercise)
              WHERE ${where}
              OPTIONAL MATCH (exercise)-[:COVERS_TOPIC]->(t:Topic)
              WHERE t.name = $topic OR t.name CONTAINS $topic
              WITH exam, exercise, t
              WHERE t IS NOT NULL
              RETURN
                exercise.id AS exercise_id,
                exercise.exercise_title AS exercise_title,
                exam.year AS year,
                exam.session AS session,
                exam.section AS section,
                exam.subject AS subject,
                t.name AS topic
              LIMIT toInteger($limit)
            `;
            params.topic = topic;
          } else {
            cypher = `
              MATCH (exam:Exam)-[:CONTAINS]->(exercise:Exercise)
              WHERE ${where}
              OPTIONAL MATCH (exercise)-[:COVERS_TOPIC]->(t:Topic)
              RETURN
                exercise.id AS exercise_id,
                exercise.exercise_title AS exercise_title,
                exam.year AS year,
                exam.session AS session,
                exam.section AS section,
                exam.subject AS subject,
                t.name AS topic
              LIMIT toInteger($limit)
            `;
          }

          neo4jSession = driver.session();
          const result = await neo4jSession.run(cypher, params);
          const rows = result.records.map((r) => r.toObject());
          return JSON.stringify(rows);
        } catch (err) {
          this.logger.warn(`query_exam_graph failed: ${String(err)}`);
          return `Error querying exam graph: ${(err as Error).message}`;
        } finally {
          if (neo4jSession) {
            await neo4jSession.close().catch(() => undefined);
          }
        }
      },
      {
        name: 'query_exam_graph',
        description:
          'Queries Neo4j to find specific exams/exercises based on metadata ' +
          'filters. Useful for structured navigation like finding all "Math" ' +
          'exams from "2020".',
        schema: z.object({
          year: z.number().int().optional(),
          session: z
            .enum(['principale', 'controle'])
            .optional()
            .describe('Session type'),
          section: z
            .string()
            .optional()
            .describe('Section (math, sciences, technique, informatique)'),
          subject: z.string().optional(),
          topic: z.string().optional(),
          limit: z.number().int().optional(),
        }),
      },
    );
  }

  private getContentByIdTool(): StructuredToolInterface {
    return tool(
      async ({ doc_id }) => {
        try {
          const point = await this.qdrant.scrollByDocId(doc_id);
          if (!point) {
            return `No content found for doc_id=${doc_id}.`;
          }
          return JSON.stringify(point.payload ?? {});
        } catch (err) {
          this.logger.warn(`get_content_by_id failed: ${String(err)}`);
          return `Error getting content: ${(err as Error).message}`;
        }
      },
      {
        name: 'get_content_by_id',
        description:
          'Fetches the full content (text, LaTeX, metadata) for a specific ' +
          'exercise/document by its doc_id. Use this after search_vectors or ' +
          'query_exam_graph to retrieve full content.',
        schema: z.object({
          doc_id: z.string().describe('The document id'),
        }),
      },
    );
  }
}
