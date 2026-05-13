import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/utils/supabase/auth';

const BACKEND_URL = process.env.BACKEND_URL || 'http://backend:5000';

/**
 * POST /api/chat/stream
 *
 * Browser-facing proxy for the NestJS Vercel AI SDK data-stream endpoint.
 * The backend is only reachable from within the Docker network, so we
 * authenticate the user against Supabase here, then forward the request
 * with a service-side bearer token. The response body is piped through
 * unchanged so AI SDK chunks (`text-start`, `text-delta`, `tool-input-
 * available`, `finish`, …) reach the client untouched.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser();
    if (!auth.ok) {
      return NextResponse.json(
        { error: 'Unauthorized', message: auth.message },
        { status: 401 },
      );
    }

    const body = await request.json();

    // useChat sends { id, messages: UIMessage[], trigger, ... }. We only need
    // the latest user message + the thread id to kick off a single agent
    // turn server-side; the LangGraph checkpointer reconstructs full history
    // from Postgres, so we don't have to ship the whole transcript.
    const threadId: string | undefined = body?.id ?? body?.threadId;
    const messages = body?.messages ?? [];
    const lastUser = [...messages]
      .reverse()
      .find((m: { role?: string }) => m?.role === 'user');
    const text = extractUserText(lastUser);

    if (!threadId || !text) {
      return NextResponse.json(
        {
          error: 'Bad Request',
          message: 'Missing thread id or last user message.',
        },
        { status: 400 },
      );
    }

    const upstream = await fetch(`${BACKEND_URL}/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.accessToken}`,
      },
      body: JSON.stringify({ threadId, message: text }),
      signal: request.signal,
    });

    if (!upstream.ok || !upstream.body) {
      // Pass through the status and body so the client can distinguish
      // quota errors (429) from transient failures (5xx).
      const responseText = await upstream.text().catch(() => '');
      let errorBody: Record<string, unknown>;
      try {
        errorBody = JSON.parse(responseText) as Record<string, unknown>;
      } catch {
        errorBody = {
          error: 'Backend Error',
          message: responseText || upstream.statusText,
        };
      }
      return NextResponse.json(errorBody, {
        status: upstream.status || 502,
      });
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type':
          upstream.headers.get('content-type') ?? 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        // Vercel AI SDK marker so `useChat` parses correctly.
        'x-vercel-ai-ui-message-stream': 'v1',
      },
    });
  } catch (error) {
    console.error('Chat stream proxy error:', error);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        message:
          error instanceof Error ? error.message : 'Failed to stream chat',
      },
      { status: 500 },
    );
  }
}

interface UIMessageLike {
  content?: unknown;
  parts?: Array<{ type?: string; text?: string }>;
}

function extractUserText(msg: UIMessageLike | undefined): string {
  if (!msg) return '';
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.parts)) {
    return msg.parts
      .filter((p) => p?.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text)
      .join('\n');
  }
  return '';
}
