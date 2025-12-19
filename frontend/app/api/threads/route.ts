import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

// Backend URL - only accessible within Docker network
const BACKEND_URL = process.env.BACKEND_URL || 'http://backend:5000';

/**
 * POST /api/threads - Create a new thread
 * Proxies to backend: POST /threads
 */
export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();

        // First try to get the session (which includes the access token)
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();

        if (sessionError) {
            console.error('Session error:', sessionError.message);
            return NextResponse.json(
                { error: 'Unauthorized', message: sessionError.message },
                { status: 401 }
            );
        }

        if (!session) {
            console.error('No session found');
            return NextResponse.json(
                { error: 'Unauthorized', message: 'No active session. Please log in.' },
                { status: 401 }
            );
        }

        // Get the request body
        const body = await request.json();

        console.log('Creating thread:', {
            backendUrl: BACKEND_URL,
            userId: session.user?.id,
            title: body.title
        });

        // Forward the request to the backend
        const response = await fetch(`${BACKEND_URL}/threads`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`,
            },
            body: JSON.stringify(body),
        });

        // Handle non-JSON responses
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text();
            console.error('Backend returned non-JSON response:', response.status, text);
            return NextResponse.json(
                { error: 'Backend Error', message: text || 'Unexpected response from backend' },
                { status: response.status }
            );
        }

        const data = await response.json();

        if (!response.ok) {
            console.error('Backend error:', response.status, data);
            return NextResponse.json(data, { status: response.status });
        }

        return NextResponse.json(data, { status: 201 });
    } catch (error) {
        console.error('Error creating thread:', error);
        return NextResponse.json(
            { error: 'Internal Server Error', message: error instanceof Error ? error.message : 'Failed to create thread' },
            { status: 500 }
        );
    }
}

/**
 * GET /api/threads - List user's threads
 * Proxies to backend: GET /threads
 */
export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();

        if (sessionError || !session) {
            return NextResponse.json(
                { error: 'Unauthorized', message: 'You must be logged in' },
                { status: 401 }
            );
        }

        // Get query params
        const { searchParams } = new URL(request.url);
        const page = searchParams.get('page') || '1';
        const limit = searchParams.get('limit') || '20';

        const response = await fetch(
            `${BACKEND_URL}/threads?page=${page}&limit=${limit}`,
            {
                headers: {
                    'Authorization': `Bearer ${session.access_token}`,
                },
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return NextResponse.json(data, { status: response.status });
        }

        return NextResponse.json(data);
    } catch (error) {
        console.error('Error fetching threads:', error);
        return NextResponse.json(
            { error: 'Internal Server Error', message: 'Failed to fetch threads' },
            { status: 500 }
        );
    }
}
