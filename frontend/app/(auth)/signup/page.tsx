"use client";

import Link from "next/link";
import { Eye, EyeOff, Loader2, ArrowRight } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signup } from "../actions";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signupSchema, type SignupInput } from "@/lib/validations/auth";
import { AuthShell } from "@/components/auth/auth-shell";
import { GoogleButton } from "@/components/auth/google-button";
import { PasswordStrength } from "@/components/auth/password-strength";

export default function SignupPage() {
    const [showPassword, setShowPassword] = useState(false);
    const [isPending, startTransition] = useTransition();

    const {
        register,
        handleSubmit,
        watch,
        formState: { errors, isValid },
    } = useForm<SignupInput>({
        resolver: zodResolver(signupSchema),
        mode: "onChange",
        defaultValues: {
            fullName: "",
            email: "",
            password: "",
            confirmPassword: "",
        },
    });

    const passwordValue = watch("password") ?? "";

    const onSubmit = (data: SignupInput) => {
        startTransition(async () => {
            const formData = new FormData();
            formData.append("fullName", data.fullName);
            formData.append("email", data.email);
            formData.append("password", data.password);
            formData.append("confirmPassword", data.confirmPassword);
            const result = await signup(null, formData);
            if (result && !result.success && result.message) {
                toast.error(result.message);
            }
        });
    };

    return (
        <AuthShell
            panel={{
                badge: "Join BacPrep",
                title: (
                    <>
                        Study smarter for the{" "}
                        <span className="bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
                            Bac
                        </span>
                        , one concept at a time.
                    </>
                ),
                subtitle:
                    "Personalised explanations, past-paper practice, and a study plan that adapts to your section.",
            }}
            title="Create your account"
            subtitle="Join BacPrep AI and start your learning journey."
            footer={
                <>
                    Already have an account?{" "}
                    <Link
                        href="/login"
                        className="font-semibold text-primary hover:text-primary/80"
                    >
                        Sign in
                    </Link>
                </>
            }
        >
            <form
                onSubmit={handleSubmit(onSubmit)}
                className="space-y-4"
                noValidate
            >
                <div className="space-y-1.5">
                    <Label htmlFor="fullName" className="text-sm font-medium">
                        Full Name
                    </Label>
                    <Input
                        id="fullName"
                        type="text"
                        autoComplete="name"
                        placeholder="Enter your full name"
                        className="h-12 rounded-lg border-border bg-card px-4 text-sm placeholder:text-muted-foreground/50"
                        {...register("fullName")}
                    />
                    {errors.fullName && (
                        <p className="text-sm text-destructive">
                            {errors.fullName.message}
                        </p>
                    )}
                </div>

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
                        <p className="text-sm text-destructive">
                            {errors.email.message}
                        </p>
                    )}
                </div>

                <div className="space-y-1.5">
                    <Label htmlFor="password" className="text-sm font-medium">
                        Password
                    </Label>
                    <div className="relative">
                        <Input
                            id="password"
                            type={showPassword ? "text" : "password"}
                            autoComplete="new-password"
                            placeholder="Create a password"
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
                    <PasswordStrength value={passwordValue} />
                    {errors.password && (
                        <p className="text-sm text-destructive">
                            {errors.password.message}
                        </p>
                    )}
                </div>

                <div className="space-y-1.5">
                    <Label
                        htmlFor="confirmPassword"
                        className="text-sm font-medium"
                    >
                        Confirm Password
                    </Label>
                    <Input
                        id="confirmPassword"
                        type="password"
                        autoComplete="new-password"
                        placeholder="Confirm your password"
                        className="h-12 rounded-lg border-border bg-card px-4 text-sm placeholder:text-muted-foreground/50"
                        {...register("confirmPassword")}
                    />
                    {errors.confirmPassword && (
                        <p className="text-sm text-destructive">
                            {errors.confirmPassword.message}
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
                            Creating your account…
                        </>
                    ) : (
                        <>
                            Create account
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

            <GoogleButton label="Sign up with Google" />

            <p className="mt-5 text-center text-xs text-muted-foreground">
                By creating an account you agree to our{" "}
                <a className="underline-offset-2 hover:underline" href="#">
                    Terms
                </a>{" "}
                and{" "}
                <a className="underline-offset-2 hover:underline" href="#">
                    Privacy Policy
                </a>
                .
            </p>
        </AuthShell>
    );
}
