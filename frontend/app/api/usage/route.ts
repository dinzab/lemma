import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/utils/supabase/auth';

const BACKEND_URL = process.env.BACKEND_URL || 'http://backend:5000';

/**
 * GET /api/usage — proxy to backend GET /usage
 * Returns the authenticated user's current token usage snapshot.
 */
export async function GET() {
  try {
    const auth = await getAuthenticatedUser();
    if (!auth.ok) {
      return NextResponse.json(
        { error: 'Unauthorized', message: auth.message },
        { status: 401 },
      );
    }

    const response = await fetch(`${BACKEND_URL}/usage`, {
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching usage:', error);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        message: 'Failed to fetch usage data',
      },
      { status: 500 },
    );
  }
}
