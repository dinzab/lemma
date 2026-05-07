import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/utils/supabase/auth";

const BACKEND_URL = process.env.BACKEND_URL || "http://backend:5000";

/**
 * GET /api/threads/[id]/active-run
 *
 * Browser-facing proxy for the NestJS `/threads/:id/active-run`
 * endpoint. Returns `{ runId, status }` for the most recent run on the
 * thread (or `{ runId: null, status: 'idle' }` if none) so the chat
 * page can decide on mount whether to show "previous run failed —
 * retry?" or wait for an in-flight run to finalize.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthenticatedUser();
    if (!auth.ok) {
      return NextResponse.json(
        { error: "Unauthorized", message: auth.message },
        { status: 401 },
      );
    }

    const { id } = await context.params;
    const upstream = await fetch(
      `${BACKEND_URL}/threads/${id}/active-run`,
      {
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
        },
      },
    );

    const data = await upstream.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstream.status });
  } catch (error) {
    console.error("active-run proxy error:", error);
    return NextResponse.json(
      {
        error: "Internal Server Error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to fetch active run",
      },
      { status: 500 },
    );
  }
}
