"use client";

import Link from "next/link";
import * as React from "react";
import { useTheme } from "next-themes";
import {
  Moon,
  Sun,
  ArrowRight,
  BookOpen,
  Brain,
  MessageSquare,
  Sparkles,
  Target,
  Zap,
  GraduationCap,
  Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Home() {
  const { setTheme, theme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="relative flex min-h-screen w-full flex-col bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-md">
        <div className="container mx-auto flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="bg-primary rounded-lg p-1.5">
              <GraduationCap className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-lg font-bold font-body">BacPrep AI</span>
          </div>
          <nav className="hidden items-center gap-8 md:flex">
            <a className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground" href="#features">
              Features
            </a>
            <a className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground" href="#how-it-works">
              How it Works
            </a>
            <a className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground" href="#testimonials">
              Testimonials
            </a>
            <Link className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground" href="/login">
              Login
            </Link>
          </nav>
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full"
              onClick={() => mounted && setTheme(theme === "dark" ? "light" : "dark")}
            >
              {mounted && theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              <span className="sr-only">Toggle theme</span>
            </Button>
            <Link href="/signup">
              <Button className="rounded-full px-5 h-9 text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90">
                Get Started
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-grow">
        {/* Hero Section */}
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent" />
          <div className="container relative mx-auto px-4 pt-20 pb-24 sm:px-6 lg:px-8 lg:pt-28 lg:pb-32">
            <div className="flex flex-col items-center gap-8 text-center max-w-4xl mx-auto">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-semibold text-primary">AI-Powered Tutoring for Bac Students</span>
              </div>

              <h1 className="text-4xl font-bold leading-tight tracking-tight text-foreground sm:text-5xl md:text-6xl lg:text-7xl">
                Study smarter,{" "}
                <span className="text-primary">ace your Bac</span>
              </h1>

              <p className="max-w-2xl text-base text-muted-foreground md:text-lg leading-relaxed">
                Your personal AI tutor that adapts to your learning style. Get instant explanations, 
                practice exams, and structured summaries tailored to the Tunisian Baccalaureate curriculum.
              </p>

              <div className="flex flex-col sm:flex-row items-center gap-4 pt-2">
                <Link href="/signup">
                  <Button size="lg" className="rounded-full px-8 h-12 text-base font-semibold bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20">
                    Start Studying Free
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Button>
                </Link>
                <Link href="/login">
                  <Button variant="outline" size="lg" className="rounded-full px-8 h-12 text-base font-semibold border-border/60 hover:bg-accent">
                    I have an account
                  </Button>
                </Link>
              </div>

              <div className="flex items-center gap-6 pt-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <div className="flex -space-x-2">
                    {[1, 2, 3, 4].map((i) => (
                      <div key={i} className="h-7 w-7 rounded-full border-2 border-background bg-primary/20 flex items-center justify-center">
                        <span className="text-[10px] font-bold text-primary">{String.fromCharCode(64 + i)}</span>
                      </div>
                    ))}
                  </div>
                  <span className="font-medium">10K+ students</span>
                </div>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Star key={i} className="h-3.5 w-3.5 fill-primary text-primary" />
                  ))}
                  <span className="ml-1 font-medium">4.8</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section id="features" className="py-20 lg:py-28">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                Everything you need to{" "}
                <span className="text-primary">succeed</span>
              </h2>
              <p className="mt-4 max-w-2xl mx-auto text-muted-foreground">
                Built specifically for Tunisian Baccalaureate students with AI that understands your curriculum.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[
                {
                  icon: Brain,
                  title: "Adaptive AI Tutoring",
                  description: "Get personalized explanations that adapt to your learning style and pace. The AI identifies gaps and reinforces weak areas.",
                },
                {
                  icon: BookOpen,
                  title: "Exam Preparation",
                  description: "Practice with past exam questions, get instant feedback, and track your progress across all subjects.",
                },
                {
                  icon: MessageSquare,
                  title: "Interactive Chat",
                  description: "Ask questions naturally in Arabic, French, or English. Get detailed, step-by-step explanations.",
                },
                {
                  icon: Target,
                  title: "Curriculum Aligned",
                  description: "Content structured around the official Tunisian Baccalaureate program for all sections and subjects.",
                },
                {
                  icon: Zap,
                  title: "Instant Summaries",
                  description: "Generate concise summaries of any topic. Perfect for last-minute revision before exams.",
                },
                {
                  icon: Sparkles,
                  title: "Smart Study Plans",
                  description: "AI-generated study schedules that optimize your time and focus on high-impact topics.",
                },
              ].map((feature, i) => (
                <div
                  key={i}
                  className="group relative rounded-2xl border border-border/60 bg-card p-6 transition-all hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5"
                >
                  <div className="mb-4 inline-flex rounded-xl bg-primary/10 p-3">
                    <feature.icon className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="mb-2 text-lg font-semibold">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it Works */}
        <section id="how-it-works" className="py-20 lg:py-28 bg-muted/30">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                How it works
              </h2>
              <p className="mt-4 max-w-2xl mx-auto text-muted-foreground">
                Get started in minutes. No complicated setup required.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
              {[
                {
                  step: "01",
                  title: "Create your account",
                  description: "Sign up for free and tell us your section and subjects. We personalize everything from the start.",
                },
                {
                  step: "02",
                  title: "Ask anything",
                  description: "Type your question in any language. Our AI tutor breaks down complex topics into clear, digestible explanations.",
                },
                {
                  step: "03",
                  title: "Master your subjects",
                  description: "Practice with targeted exercises, review summaries, and track your improvement over time.",
                },
              ].map((item, i) => (
                <div key={i} className="relative text-center">
                  <div className="mb-6 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground text-lg font-bold">
                    {item.step}
                  </div>
                  <h3 className="mb-3 text-lg font-semibold">{item.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{item.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Testimonials */}
        <section id="testimonials" className="py-20 lg:py-28">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                Loved by students
              </h2>
              <p className="mt-4 max-w-2xl mx-auto text-muted-foreground">
                Join thousands of students who improved their grades with BacPrep AI.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
              {[
                {
                  quote: "BacPrep AI helped me understand physics concepts I struggled with for months. I went from 10/20 to 16/20 in my Bac exam.",
                  name: "Amira B.",
                  detail: "Sciences Section, Tunis",
                },
                {
                  quote: "The exam prep mode is incredible. It gives you questions just like the real Bac and explains every answer step by step.",
                  name: "Youssef M.",
                  detail: "Maths Section, Sfax",
                },
                {
                  quote: "I used the summary feature the night before my philosophy exam. It organized everything perfectly. Highly recommend!",
                  name: "Salma K.",
                  detail: "Lettres Section, Sousse",
                },
              ].map((testimonial, i) => (
                <div key={i} className="rounded-2xl border border-border/60 bg-card p-6">
                  <div className="flex gap-1 mb-4">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <Star key={s} className="h-4 w-4 fill-primary text-primary" />
                    ))}
                  </div>
                  <p className="text-sm text-foreground/90 leading-relaxed mb-6">
                    &ldquo;{testimonial.quote}&rdquo;
                  </p>
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-full bg-primary/15 flex items-center justify-center">
                      <span className="text-xs font-bold text-primary">{testimonial.name[0]}</span>
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{testimonial.name}</p>
                      <p className="text-xs text-muted-foreground">{testimonial.detail}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-20 lg:py-28">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="relative overflow-hidden rounded-3xl bg-primary/5 border border-primary/10 px-8 py-16 text-center sm:px-16">
              <div className="relative z-10 max-w-2xl mx-auto">
                <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4">
                  Ready to boost your grades?
                </h2>
                <p className="text-muted-foreground mb-8">
                  Start studying with AI today. It&apos;s free to get started, no credit card required.
                </p>
                <Link href="/signup">
                  <Button size="lg" className="rounded-full px-8 h-12 text-base font-semibold bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20">
                    Get Started for Free
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/40 py-8">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="bg-primary rounded-lg p-1.5">
                <GraduationCap className="h-4 w-4 text-primary-foreground" />
              </div>
              <span className="text-sm font-semibold">BacPrep AI</span>
            </div>
            <p className="text-xs text-muted-foreground">
              &copy; {new Date().getFullYear()} BacPrep AI. Built for Tunisian students.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
