import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/utils/supabase/auth';

// Backend URL - only accessible within Docker network
const BACKEND_URL = process.env.BACKEND_URL || 'http://backend:5000';

interface RouteParams {
    params: Promise<{ id: string }>;
}

/**
 * GET /api/threads/[id] - Get a specific thread
 * Proxies to backend: GET /threads/:id
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const { id: threadId } = await params;

        const auth = await getAuthenticatedUser();
        if (!auth.ok) {
            return NextResponse.json(
                { error: 'Unauthorized', message: auth.message },
                { status: 401 },
            );
        }

        const response = await fetch(`${BACKEND_URL}/threads/${threadId}`, {
            headers: {
                'Authorization': `Bearer ${auth.accessToken}`,
            },
        });

        if (response.status === 404 || response.status === 403) {
            return NextResponse.json(null, { status: response.status });
        }

        const data = await response.json();

        if (!response.ok) {
            return NextResponse.json(data, { status: response.status });
        }

        return NextResponse.json(data);
    } catch (error) {
        console.error('Error fetching thread:', error);
        return NextResponse.json(
            { error: 'Internal Server Error', message: 'Failed to fetch thread' },
            { status: 500 }
        );
    }
}

/**
 * DELETE /api/threads/[id] - Delete a thread
 * Proxies to backend: DELETE /threads/:id
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
    try {
        const { id: threadId } = await params;

        const auth = await getAuthenticatedUser();
        if (!auth.ok) {
            return NextResponse.json(
                { error: 'Unauthorized', message: auth.message },
                { status: 401 },
            );
        }

        const response = await fetch(`${BACKEND_URL}/threads/${threadId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${auth.accessToken}`,
            },
        });

        if (response.status === 204) {
            return new NextResponse(null, { status: 204 });
        }

        if (!response.ok) {
            const data = await response.json();
            return NextResponse.json(data, { status: response.status });
        }

        return new NextResponse(null, { status: 204 });
    } catch (error) {
        console.error('Error deleting thread:', error);
        return NextResponse.json(
            { error: 'Internal Server Error', message: 'Failed to delete thread' },
            { status: 500 }
        );
    }
}
