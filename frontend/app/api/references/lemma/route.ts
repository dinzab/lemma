import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/utils/supabase/auth";

const BACKEND_URL = process.env.BACKEND_URL || "http://backend:5000";

/**
 * GET /api/references/lemma?uri=<lemma_uri>
 *
 * Browser-facing proxy for the NestJS `/references/lemma` endpoint —
 * the resolver the inline citation chip falls back to when the
 * conversation-scoped `<FigureRegistry>` doesn't (yet) hold a
 * thumbnail for the cited figure, OR when a `lemma:exercise:…` /
 * `lemma:exam:…` chip's click finds no on-page surface to scroll to
 * and needs to open a fallback Dialog instead.
 *
 * Forwards the Supabase access token via `Authorization` so the
 * NestJS `SupabaseAuthGuard` can decide whether the caller may read
 * corpus metadata.
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

    const uri = request.nextUrl.searchParams.get("uri");
    if (!uri) {
      return NextResponse.json(
        {
          error: "Bad Request",
          message: 'Query parameter "uri" is required.',
        },
        { status: 400 },
      );
    }

    const upstream = await fetch(
      `${BACKEND_URL}/references/lemma?uri=${encodeURIComponent(uri)}`,
      {
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
        },
        // Resolver is intrinsically idempotent and only reads from
        // Qdrant, so it's safe to cache aggressively at the edge —
        // but keep cache off here to let the chip see fresh URLs as
        // the corpus is re-ingested. The frontend memoises in-tab.
        cache: "no-store",
      },
    );

    const data = await upstream.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstream.status });
  } catch (error) {
    console.error("references/lemma proxy error:", error);
    return NextResponse.json(
      {
        error: "Internal Server Error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to resolve lemma: URI",
      },
      { status: 500 },
    );
  }
}
