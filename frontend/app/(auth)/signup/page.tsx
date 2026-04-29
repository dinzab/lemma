"use client";

import Link from "next/link";
import { Eye, EyeOff, Loader2, GraduationCap } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signup, signInWithGoogle } from "../actions";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signupSchema, type SignupInput } from "@/lib/validations/auth";

export default function SignupPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
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
    <div className="flex min-h-screen w-full bg-background text-foreground">
      <div className="grid h-screen w-full grid-cols-1 overflow-hidden lg:grid-cols-2">
        {/* Left panel - illustration */}
        <div className="relative hidden h-full lg:block">
          <img
            alt="An illustration of a person in traditional North African attire reading a book under a large olive tree in a sunlit courtyard."
            className="h-full w-full object-cover"
            src="https://lh3.googleusercontent.com/aida-public/AB6AXuDXYxBD-H7jm0Scbl_obblxLeLrWir4oUPnE8MkTa0qFJBZi9Qla-zzoQY298y1XLU37RMLqncoP_-LOZi4z6UCSm5U6aowgEz3FgEbxKe05IkA2WwnKBqijbJjkiS5vb2ApnDDen1rSZweadfbZQKhvtYL7HqHGruIlir5v_oGMyBKUFzgBCzI9jfHP3Lmvr-D68Oe9rz4skC8_Dc_atsRyHdQD_etB6dZe5VixTprLxPvnxeDe-7IqY1MfxPc5Qj8U17WjaSGQ-c"
          />
        </div>

        {/* Right panel - form */}
        <div className="flex h-full w-full flex-col overflow-y-auto px-8 py-12 sm:px-12 lg:justify-center lg:px-16">
          <div className="mx-auto w-full max-w-md">
            {/* Logo */}
            <Link href="/" className="inline-flex items-center gap-2.5 mb-10">
              <div className="bg-primary rounded-lg p-1.5">
                <GraduationCap className="h-5 w-5 text-primary-foreground" />
              </div>
              <span className="text-lg font-bold">BacPrep AI</span>
            </Link>

            <h1 className="mb-2 text-3xl font-bold tracking-tight">
              Create an account
            </h1>
            <p className="mb-8 text-muted-foreground">
              Join us and start your AI-powered learning journey.
            </p>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <div>
                <Label className="block text-sm font-medium" htmlFor="fullName">
                  Full Name
                </Label>
                <div className="mt-1.5">
                  <Input
                    autoComplete="name"
                    className="h-11 rounded-lg border-border bg-card px-4 text-sm placeholder:text-muted-foreground/50 focus-visible:ring-primary"
                    id="fullName"
                    placeholder="Enter your full name"
                    type="text"
                    {...register("fullName")}
                  />
                  {errors.fullName && (
                    <p className="mt-1.5 text-sm text-destructive">{errors.fullName.message}</p>
                  )}
                </div>
              </div>

              <div>
                <Label className="block text-sm font-medium" htmlFor="email">
                  Email Address
                </Label>
                <div className="mt-1.5">
                  <Input
                    autoComplete="email"
                    className="h-11 rounded-lg border-border bg-card px-4 text-sm placeholder:text-muted-foreground/50 focus-visible:ring-primary"
                    id="email"
                    placeholder="you@example.com"
                    type="email"
                    {...register("email")}
                  />
                  {errors.email && (
                    <p className="mt-1.5 text-sm text-destructive">{errors.email.message}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <Label className="block text-sm font-medium" htmlFor="password">
                    Password
                  </Label>
                  <div className="relative mt-1.5">
                    <Input
                      autoComplete="new-password"
                      className="h-11 rounded-lg border-border bg-card px-4 pr-10 text-sm placeholder:text-muted-foreground/50 focus-visible:ring-primary"
                      id="password"
                      placeholder="Create a password"
                      type={showPassword ? "text" : "password"}
                      {...register("password")}
                    />
                    <button
                      className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground/60 hover:text-foreground transition-colors"
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {errors.password && (
                    <p className="mt-1.5 text-sm text-destructive">{errors.password.message}</p>
                  )}
                </div>

                <div>
                  <Label className="block text-sm font-medium" htmlFor="confirm-password">
                    Confirm Password
                  </Label>
                  <div className="mt-1.5">
                    <Input
                      autoComplete="new-password"
                      className="h-11 rounded-lg border-border bg-card px-4 text-sm placeholder:text-muted-foreground/50 focus-visible:ring-primary"
                      id="confirm-password"
                      placeholder="Confirm your password"
                      type="password"
                      {...register("confirmPassword")}
                    />
                    {errors.confirmPassword && (
                      <p className="mt-1.5 text-sm text-destructive">{errors.confirmPassword.message}</p>
                    )}
                  </div>
                </div>
              </div>

              <Button
                className="w-full h-11 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90"
                type="submit"
                disabled={isPending || !isValid}
              >
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating account...
                  </>
                ) : (
                  "Sign Up"
                )}
              </Button>
            </form>

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border"></span>
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-3 text-muted-foreground">
                  Or continue with
                </span>
              </div>
            </div>

            <button
              className="inline-flex w-full items-center justify-center rounded-lg border border-border bg-card h-11 px-4 text-sm font-medium shadow-sm transition-colors hover:bg-accent"
              onClick={() => signInWithGoogle()}
              type="button"
            >
              <svg className="mr-3 h-5 w-5" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              Sign up with Google
            </button>

            <p className="mt-8 text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link className="font-semibold text-primary hover:text-primary/80" href="/login">
                Sign In
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
