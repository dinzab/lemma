/**
 * Thread API Client
 * 
 * Uses Next.js API routes as a proxy to the backend.
 * This allows the frontend (browser) to communicate with the backend
 * which is only accessible within the Docker network.
 */

/**
 * Thread data structure
 */
export interface Thread {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
}

/**
 * Response from creating a thread
 */
export interface CreateThreadResponse {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
}

/**
 * Paginated threads list response
 */
export interface ThreadsListResponse {
    threads: Thread[];
    total: number;
    page: number;
    limit: number;
}

/**
 * API Error response
 */
export interface ApiError {
    statusCode?: number;
    error: string;
    message: string | string[];
}

/**
 * Sanitizes a string for display to prevent XSS
 * This is a defense-in-depth measure (backend also sanitizes)
 */
export function sanitizeTitle(input: string): string {
    if (typeof input !== 'string') return '';

    return input
        .trim()
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

/**
 * Extracts a title from the first message.
 *
 * The backend stores titles HTML-escaped (apostrophes become `&#x27;`,
 * etc. — see `sanitizeString` in the API), and validates `MaxLength(50)`
 * AFTER that escape pass. A short user prompt with one apostrophe can
 * therefore exceed 50 chars once stored, which used to fail thread
 * creation outright with `"Title must not exceed 50 characters"`.
 *
 * We solve this by:
 *
 * 1. Not pre-sanitizing on the client. The backend's @Transform always
 *    runs `sanitizeString`, so doing it twice produced triple-encoded
 *    titles like `C&amp;amp;#x27;est…` that the sidebar then rendered
 *    literally.
 * 2. Computing the post-sanitization length in the same way the backend
 *    will, and binary-searching the longest raw prefix whose escaped
 *    length still fits `maxLength` (with a single-character `…` ellipsis
 *    when truncation is needed).
 *
 * @param message - The user's first message.
 * @param maxLength - Maximum title length AFTER backend sanitization
 *   (default: 50, matching `CreateThreadDto`).
 */
export function extractTitleFromMessage(message: string, maxLength: number = 50): string {
    if (!message || typeof message !== 'string') {
        return 'New Chat';
    }

    const trimmed = message.trim();
    if (!trimmed) {
        return 'New Chat';
    }

    // Take first line only (in case of multiline message).
    const firstLine = trimmed.split('\n')[0].trim();
    if (!firstLine) {
        return 'New Chat';
    }

    if (sanitizedLength(firstLine) <= maxLength) {
        return firstLine;
    }

    // Find the longest prefix whose sanitized length, with a trailing
    // `…`, still fits maxLength. Binary search keeps this O(log n) over
    // the first-line length even though sanitization is O(n).
    const ellipsis = '…';
    let lo = 0;
    let hi = firstLine.length;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        const candidate = firstLine.slice(0, mid) + ellipsis;
        if (sanitizedLength(candidate) <= maxLength) {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    return firstLine.slice(0, lo) + ellipsis;
}

/**
 * Mirrors the backend's `sanitizeString` so we can predict the stored
 * title length. Keep this in sync with `backend/src/utils/sanitize.ts`.
 */
function sanitizedLength(s: string): number {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;')
        .replace(/\\/g, '&#x5C;')
        .replace(/`/g, '&#96;')
        .length;
}

/**
 * Creates a new thread via Next.js API route
 * The API route proxies to the backend within Docker network
 * 
 * @param title - The thread title
 * @returns The created thread data
 * @throws Error if creation fails
 */
export async function createThread(title: string): Promise<CreateThreadResponse> {
    const response = await fetch('/api/threads', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title }),
    });

    if (!response.ok) {
        const error: ApiError = await response.json().catch(() => ({
            error: 'Unknown Error',
            message: 'Failed to create thread',
        }));

        const message = Array.isArray(error.message)
            ? error.message.join(', ')
            : error.message;

        throw new Error(message);
    }

    return response.json();
}

/**
 * Fetches a thread by ID via Next.js API route
 * Returns null if thread not found or user not authorized
 * 
 * @param threadId - The thread ID
 * @returns The thread data or null
 */
export async function getThread(threadId: string): Promise<Thread | null> {
    try {
        const response = await fetch(`/api/threads/${threadId}`);

        if (response.status === 404 || response.status === 403 || response.status === 401) {
            return null;
        }

        if (!response.ok) {
            console.error('Failed to fetch thread:', response.status);
            return null;
        }

        return response.json();
    } catch (error) {
        console.error('Error fetching thread:', error);
        return null;
    }
}

/**
 * Fetches all threads for the current user via Next.js API route
 * 
 * @param page - Page number (default: 1)
 * @param limit - Items per page (default: 20)
 * @returns Paginated list of threads
 */
export async function getUserThreads(
    page: number = 1,
    limit: number = 20
): Promise<ThreadsListResponse> {
    const response = await fetch(`/api/threads?page=${page}&limit=${limit}`);

    if (!response.ok) {
        throw new Error('Failed to fetch threads');
    }

    return response.json();
}

/**
 * Deletes a thread via Next.js API route
 * 
 * @param threadId - The thread ID to delete
 */
export async function deleteThread(threadId: string): Promise<void> {
    const response = await fetch(`/api/threads/${threadId}`, {
        method: 'DELETE',
    });

    if (!response.ok && response.status !== 204) {
        throw new Error('Failed to delete thread');
    }
}

/**
 * Renames a thread via Next.js API route
 *
 * @param threadId - The thread ID to rename
 * @param title - The new thread title
 */
export async function renameThread(threadId: string, title: string): Promise<Thread> {
    const response = await fetch(`/api/threads/${threadId}`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: sanitizeTitle(title) }),
    });

    if (!response.ok) {
        const error: ApiError = await response.json().catch(() => ({
            error: 'Unknown Error',
            message: 'Failed to rename thread',
        }));

        const message = Array.isArray(error.message)
            ? error.message.join(', ')
            : error.message;

        throw new Error(message);
    }

    return response.json();
}
