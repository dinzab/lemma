import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

/**
 * Returns true only when `target` is a same-site path safe for redirect.
 *
 * Rejects:
 *  - absolute URLs (`https://evil.com/...`)
 *  - protocol-relative (`//evil.com/...`)
 *  - backslash variants browsers may resolve as protocol-relative (`/\evil`)
 *  - anything not starting with `/`
 *
 * This prevents an attacker from crafting a phishing link like
 * `/api/auth/callback?next=//evil.com` that bounces a logged-in user
 * off-domain after the OAuth round-trip.
 */
function safeNextPath(target: string | null): string {
    if (!target) return '/new'
    if (!target.startsWith('/')) return '/new'
    if (target.startsWith('//') || target.startsWith('/\\')) return '/new'
    return target
}

export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url)
    const code = searchParams.get('code')
    const next = safeNextPath(searchParams.get('next'))

    if (code) {
        const supabase = await createClient()
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (!error) {
            const forwardedHost = request.headers.get('x-forwarded-host') // original origin before load balancer
            const isLocalEnv = process.env.NODE_ENV === 'development'
            if (isLocalEnv) {
                // we can be sure that there is no load balancer in between, so no need to watch for X-Forwarded-Host
                return NextResponse.redirect(`${origin}${next}`)
            } else if (forwardedHost) {
                return NextResponse.redirect(`https://${forwardedHost}${next}`)
            } else {
                return NextResponse.redirect(`${origin}${next}`)
            }
        }
    }

    // return the user to an error page with instructions
    return NextResponse.redirect(`${origin}/auth/auth-code-error`)
}
