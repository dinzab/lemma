import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/utils/supabase/auth";

const BACKEND_URL = process.env.BACKEND_URL || "http://backend:5000";

/**
 * GET /api/chat/stream/resume?runId=...
 *
 * Browser-facing proxy for the NestJS `/chat/stream/resume` endpoint.
 * Lets the chat hook re-attach to an in-flight agent turn after a page
 * reload or transient network drop without re-sending the user prompt.
 *
 * The upstream response is the same Vercel AI SDK UI message stream as
 * `POST /chat/stream`, so the body is forwarded unchanged. Aborting the
 * client request also cancels the upstream fetch so the backend can
 * release its hub subscriber promptly.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser();
    if (!auth.ok) {
      return NextResponse.json(
        { error: "Unauthorized", message: auth.message },
        { status: 401 },
      );
    }

    const runId = request.nextUrl.searchParams.get("runId");
    if (!runId) {
      return NextResponse.json(
        { error: "Bad Request", message: "Missing runId." },
        { status: 400 },
      );
    }

    const upstream = await fetch(
      `${BACKEND_URL}/chat/stream/resume?runId=${encodeURIComponent(runId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
        },
        signal: request.signal,
      },
    );

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => "");
      return NextResponse.json(
        { error: "Backend Error", message: text || upstream.statusText },
        { status: upstream.status || 502 },
      );
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type":
          upstream.headers.get("content-type") ?? "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "x-vercel-ai-ui-message-stream": "v1",
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return new Response(null, { status: 499 });
    }
    console.error("Resume stream proxy error:", error);
    return NextResponse.json(
      {
        error: "Internal Server Error",
        message:
          error instanceof Error ? error.message : "Failed to resume stream.",
      },
      { status: 500 },
    );
  }
}
