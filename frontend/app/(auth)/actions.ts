'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import { loginSchema, signupSchema } from '@/lib/validations/auth'

export type ActionState = {
    success?: boolean
    message?: string
    errors?: { [key: string]: string[] } | null
    inputs?: Record<string, FormDataEntryValue>
}

export async function login(prevState: ActionState | null, formData: FormData): Promise<ActionState> {
    const rawData = Object.fromEntries(formData.entries())

    // 1. Validate Input with Zod
    const validatedFields = loginSchema.safeParse(rawData)

    if (!validatedFields.success) {
        return {
            success: false,
            message: "Please check your inputs.",
            errors: validatedFields.error.flatten().fieldErrors,
            inputs: rawData,
        }
    }

    const { email, password } = validatedFields.data
    const supabase = await createClient()

    // 2. Authenticate with Supabase
    const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
    })

    if (error) {
        return {
            success: false,
            message: error.message,
            inputs: rawData,
        }
    }

    // 3. Success
    revalidatePath('/', 'layout')
    redirect('/new')
}

export async function signup(prevState: ActionState | null, formData: FormData): Promise<ActionState> {
    const rawData = Object.fromEntries(formData.entries())

    // 1. Validate Input with Zod
    const validatedFields = signupSchema.safeParse(rawData)

    if (!validatedFields.success) {
        return {
            success: false,
            message: "Please fix the errors below.",
            errors: validatedFields.error.flatten().fieldErrors,
            inputs: rawData,
        }
    }

    const { email, password, fullName } = validatedFields.data
    const supabase = await createClient()

    // 2. Create User in Supabase
    const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
            data: {
                full_name: fullName,
            },
        },
    })

    if (error) {
        return {
            success: false,
            message: error.message,
            inputs: rawData,
        }
    }

    // 3. Success
    revalidatePath('/', 'layout')
    redirect('/new')
}

import { getURL } from '@/utils/helpers'

export async function signInWithGoogle() {
    const supabase = await createClient()
    const url = getURL()

    const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: `${url}api/auth/callback`,
        },
    })

    if (error) {
        // Since this is usually called via onClick, we might need a different way to handle errors 
        // or just let the redirect fail. For now, we return the error.
        return { error: error.message }
    }

    if (data.url) {
        redirect(data.url)
    }
}

export async function logout() {
    const supabase = await createClient()
    await supabase.auth.signOut()
    revalidatePath('/', 'layout')
    redirect('/login')
}
