"use client";

import Link from "next/link";
import { Eye, EyeOff, Loader2, ArrowRight } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login } from "../actions";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { loginSchema, type LoginInput } from "@/lib/validations/auth";
import { AuthShell } from "@/components/auth/auth-shell";
import { GoogleButton } from "@/components/auth/google-button";

export default function LoginPage() {
    const [showPassword, setShowPassword] = useState(false);
    const [isPending, startTransition] = useTransition();

    const {
        register,
        handleSubmit,
        formState: { errors, isValid },
    } = useForm<LoginInput>({
        resolver: zodResolver(loginSchema),
        mode: "onChange",
        defaultValues: { email: "", password: "" },
    });

    const onSubmit = (data: LoginInput) => {
        startTransition(async () => {
            const formData = new FormData();
            formData.append("email", data.email);
            formData.append("password", data.password);
            const result = await login(null, formData);
            if (result && !result.success && result.message) {
                toast.error(result.message);
            }
        });
    };

    return (
        <AuthShell
            panel={{
                badge: "Welcome back",
                title: (
                    <>
                        Pick up where you{" "}
                        <span className="bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
                            left off
                        </span>
                        .
                    </>
                ),
                subtitle:
                    "Your tutor remembers every concept you've worked on — sign in and keep moving toward Bac day.",
            }}
            title="Welcome back"
            subtitle="Sign in to continue your learning journey."
            footer={
                <>
                    Don&apos;t have an account?{" "}
                    <Link
                        href="/signup"
                        className="font-semibold text-primary hover:text-primary/80"
                    >
                        Sign up
                    </Link>
                </>
            }
        >
            <form
                onSubmit={handleSubmit(onSubmit)}
                className="space-y-5"
                noValidate
            >
                <div className="space-y-1.5">
                    <Label htmlFor="email" className="text-sm font-medium">
                        Email Address
                    </Label>
                    <Input
                        id="email"
                        type="email"
                        autoComplete="email"
                        placeholder="you@example.com"
                        className="h-12 rounded-lg border-border bg-card px-4 text-sm placeholder:text-muted-foreground/50"
                        {...register("email")}
                    />
                    {errors.email && (
                        <p className="text-sm text-destructive">{errors.email.message}</p>
                    )}
                </div>

                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <Label htmlFor="password" className="text-sm font-medium">
                            Password
                        </Label>
                        <Link
                            href="#"
                            aria-disabled
                            className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
                        >
                            Forgot?
                        </Link>
                    </div>
                    <div className="relative">
                        <Input
                            id="password"
                            type={showPassword ? "text" : "password"}
                            autoComplete="current-password"
                            placeholder="Enter your password"
                            className="h-12 rounded-lg border-border bg-card px-4 pr-11 text-sm placeholder:text-muted-foreground/50"
                            {...register("password")}
                        />
                        <button
                            type="button"
                            onClick={() => setShowPassword((s) => !s)}
                            aria-label={showPassword ? "Hide password" : "Show password"}
                            className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground transition-colors hover:text-foreground"
                        >
                            {showPassword ? (
                                <EyeOff className="h-4 w-4" />
                            ) : (
                                <Eye className="h-4 w-4" />
                            )}
                        </button>
                    </div>
                    {errors.password && (
                        <p className="text-sm text-destructive">
                            {errors.password.message}
                        </p>
                    )}
                </div>

                <Button
                    type="submit"
                    disabled={isPending || !isValid}
                    className="group h-12 w-full rounded-lg bg-gradient-to-r from-primary to-[#fc7146] text-base font-semibold text-primary-foreground shadow-md transition-all hover:from-primary hover:to-primary hover:shadow-lg disabled:opacity-60"
                >
                    {isPending ? (
                        <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Signing in…
                        </>
                    ) : (
                        <>
                            Sign in
                            <ArrowRight className="ml-1.5 size-4 transition-transform group-hover:translate-x-0.5" />
                        </>
                    )}
                </Button>
            </form>

            <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase tracking-wider">
                    <span className="bg-background px-3 text-muted-foreground">
                        Or continue with
                    </span>
                </div>
            </div>

            <GoogleButton label="Sign in with Google" />
        </AuthShell>
    );
}
