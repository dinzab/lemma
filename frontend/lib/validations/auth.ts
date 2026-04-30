import { z } from "zod";

export const loginSchema = z.object({
    email: z
        .string()
        .trim()
        .min(1, { message: "Email is required" })
        .max(254, { message: "Email is too long" })
        .email({ message: "Invalid email address" }),
    password: z
        .string()
        .min(1, { message: "Password is required" })
        .max(128, { message: "Password must be less than 128 characters" }),
});

export const signupSchema = z.object({
    fullName: z
        .string()
        .trim()
        .min(2, { message: "Name must be at least 2 characters" })
        .max(80, { message: "Name must be less than 80 characters" })
        // Accept any unicode letter so non-Latin scripts and accented Latin
        // characters (e.g. José, محمد, 张伟) aren't rejected. Still excludes
        // digits, punctuation other than space / hyphen / apostrophe.
        .regex(/^[\p{L}\s'-]+$/u, { message: "Name can only contain letters, spaces, hyphens, and apostrophes" }),
    email: z
        .string()
        .trim()
        .min(1, { message: "Email is required" })
        .max(254, { message: "Email is too long" })
        .email({ message: "Invalid email address" }),
    password: z
        .string()
        .min(8, { message: "Password must be at least 8 characters" })
        .max(128, { message: "Password must be less than 128 characters" })
        .regex(/[A-Z]/, { message: "Password must contain at least one uppercase letter" })
        .regex(/[a-z]/, { message: "Password must contain at least one lowercase letter" })
        .regex(/[0-9]/, { message: "Password must contain at least one number" })
        .regex(/[^A-Za-z0-9]/, { message: "Password must contain at least one special character" }),
    confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
});

export type LoginInput = z.infer<typeof loginSchema>;
export type SignupInput = z.infer<typeof signupSchema>;
