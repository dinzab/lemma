import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
    let supabaseResponse = NextResponse.next({
        request,
    })

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll()
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value }) =>
                        request.cookies.set(name, value)
                    )
                    supabaseResponse = NextResponse.next({
                        request,
                    })
                    cookiesToSet.forEach(({ name, value, options }) =>
                        supabaseResponse.cookies.set(name, value, options)
                    )
                },
            },
        }
    )

    // IMPORTANT: You *must* return the supabaseResponse object as it is. If you're
    // creating a new Response object with NextResponse.next() make sure to:
    // 1. Pass the request in it, like so:
    //    const myNewResponse = NextResponse.next({ request })
    // 2. Copy over the cookies, like so:
    //    myNewResponse.cookies.setAll(supabaseResponse.cookies.getAll())
    // 3. Change the myNewResponse object to fit your needs, but avoid changing
    //    the cookies!
    // 4. Finally:
    //    return myNewResponse
    // If this is not done, you may be causing the browser and server to go out
    // of sync and terminate the user's session prematurely!

    const {
        data: { user },
    } = await supabase.auth.getUser()

    const path = request.nextUrl.pathname

    // 1. Unauthenticated Users
    if (!user) {
        // Allow access to landing page, login, signup, auth callback,
        // and the public health check used by the orchestrator/Docker.
        if (
            path === '/' ||
            path.startsWith('/login') ||
            path.startsWith('/signup') ||
            path.startsWith('/api/auth') ||
            path === '/api/health'
        ) {
            return supabaseResponse
        }
        // Redirect all other requests to login
        const url = request.nextUrl.clone()
        url.pathname = '/login'
        return NextResponse.redirect(url)
    }

    // 2. Authenticated Users
    if (user) {
        // Redirect from login/signup to dashboard
        if (path.startsWith('/login') || path.startsWith('/signup')) {
            const url = request.nextUrl.clone()
            url.pathname = '/new'
            return NextResponse.redirect(url)
        }
    }

    return supabaseResponse
}
