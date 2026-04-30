import { createClient } from '@/utils/supabase/server'

export type AuthSuccess = {
    ok: true
    userId: string
    accessToken: string
}

export type AuthFailure = {
    ok: false
    status: 401
    message: string
}

/**
 * Server-side auth helper: verifies the current request belongs to a logged-in
 * user and returns their access token for upstream forwarding.
 *
 * Why both calls?
 *   - `supabase.auth.getUser()` round-trips to Supabase Auth and is the only
 *     server-side call that actually verifies the session cookies. Using it
 *     here mirrors the guidance from @supabase/ssr's getting-started docs.
 *   - `supabase.auth.getSession()` just decodes cookies. After getUser() has
 *     succeeded the cookies are trusted, so it's safe to read the session
 *     purely to retrieve `access_token` for forwarding to the NestJS backend.
 *
 * Do NOT call getSession() alone for authorization decisions: a tampered
 * cookie can return a "session" that looks valid but hasn't been verified.
 */
export async function getAuthenticatedUser(): Promise<AuthSuccess | AuthFailure> {
    const supabase = await createClient()

    const {
        data: { user },
        error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
        return { ok: false, status: 401, message: 'No active session.' }
    }

    const {
        data: { session },
    } = await supabase.auth.getSession()

    if (!session?.access_token) {
        return { ok: false, status: 401, message: 'Session token missing.' }
    }

    return { ok: true, userId: user.id, accessToken: session.access_token }
}
