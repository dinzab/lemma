import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/utils/supabase/auth';

const BACKEND_URL = process.env.BACKEND_URL || 'http://backend:5000';

/**
 * GET /api/threads/[id]/messages?limit=&before=
 *
 * Cursor-paginated message read, newest-first. Proxies straight to the
 * NestJS backend's `/threads/:id/messages` and forwards the user's bearer
 * token so RLS / ownership checks happen server-side in NestJS.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthenticatedUser();
    if (!auth.ok) {
      return NextResponse.json(
        { error: 'Unauthorized', message: auth.message },
        { status: 401 },
      );
    }

    const { id } = await context.params;
    const url = new URL(request.url);
    const search = url.searchParams.toString();

    const upstream = await fetch(
      `${BACKEND_URL}/threads/${id}/messages${search ? `?${search}` : ''}`,
      {
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
        },
      },
    );

    const data = await upstream.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstream.status });
  } catch (error) {
    console.error('Messages proxy error:', error);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        message:
          error instanceof Error ? error.message : 'Failed to fetch messages',
      },
      { status: 500 },
    );
  }
}
