"use client";

import Link from "next/link";
import * as React from "react";
import { useTheme } from "next-themes";
import {
  Moon,
  Sun,
  ArrowUpRight,
  BookOpen,
  Brain,
  MessageSquare,
  Sparkles,
  Target,
  Zap,
  GraduationCap,
  Star,
  ChevronRight,
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
      {/* Header — matches Orion: 64px, transparent bg, blur */}
      <header className="sticky top-0 z-50 w-full bg-background/80 backdrop-blur-md">
        <div className="container mx-auto flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2.5">
            <div className="bg-primary rounded-lg p-1.5">
              <GraduationCap className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-semibold">BacPrep AI</span>
          </div>
          <nav className="hidden items-center gap-6 md:flex">
            <a className="text-base font-medium text-muted-foreground transition-colors hover:text-foreground" href="#features">
              Features
            </a>
            <a className="text-base font-medium text-muted-foreground transition-colors hover:text-foreground" href="#how-it-works">
              How it Works
            </a>
            <a className="text-base font-medium text-muted-foreground transition-colors hover:text-foreground" href="#testimonials">
              Testimonials
            </a>
            <Link className="text-base font-medium text-muted-foreground transition-colors hover:text-foreground" href="/login">
              Login
            </Link>
          </nav>
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 rounded-lg"
              onClick={() => mounted && setTheme(theme === "dark" ? "light" : "dark")}
            >
              {mounted && theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              <span className="sr-only">Toggle theme</span>
            </Button>
            <Link href="/signup">
              <Button className="h-10 px-6 text-base font-medium rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/90">
                Sign up
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-grow">
        {/* Hero Section — matches Orion layout */}
        <section className="relative overflow-hidden">
          <div className="container mx-auto px-4 pt-16 pb-20 sm:px-6 lg:px-8 lg:pt-24 lg:pb-28">
            <div className="flex flex-col items-center gap-6 text-center max-w-4xl mx-auto">
              {/* Badge pill — matches Orion style */}
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-accent px-3 py-1">
                <span className="text-xs font-semibold text-primary">🔥 New</span>
                <span className="text-xs font-medium text-foreground">Introducing AI Tutor</span>
              </div>

              <h1 className="text-4xl font-semibold leading-tight text-foreground sm:text-5xl lg:text-6xl">
                Study with AI tutor{" "}
                <br className="hidden sm:block" />
                that helps you ace{" "}
                <span className="text-primary">your Bac</span>
              </h1>

              <p className="max-w-3xl text-lg text-muted-foreground md:text-xl leading-relaxed">
                Get instant explanations, practice with past exams, and receive structured 
                summaries tailored to the Tunisian Baccalaureate curriculum.
              </p>

              <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
                <Link href="/signup">
                  <Button className="h-10 px-6 text-base font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90">
                    <ArrowUpRight className="mr-2 h-4 w-4" />
                    Get Started
                  </Button>
                </Link>
                <Link href="#features">
                  <Button variant="outline" className="h-10 px-6 text-base font-medium rounded-lg border-border bg-secondary text-secondary-foreground hover:bg-secondary/90">
                    <Sparkles className="mr-2 h-4 w-4" />
                    View Features
                  </Button>
                </Link>
              </div>

              {/* Social proof — matches Orion style */}
              <div className="flex items-center gap-6 pt-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <div className="flex -space-x-2">
                    {["A", "S", "Y", "M"].map((letter, i) => (
                      <div key={i} className="h-8 w-8 rounded-full border-2 border-background bg-accent flex items-center justify-center">
                        <span className="text-xs font-bold text-accent-foreground">{letter}</span>
                      </div>
                    ))}
                  </div>
                  <span className="font-medium">10K+ Students</span>
                </div>
                <div className="h-4 w-px bg-border" />
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Star key={i} className={`h-4 w-4 ${i <= 4 ? "fill-secondary text-secondary" : "fill-secondary/40 text-secondary/40"}`} />
                  ))}
                  <span className="ml-1 font-medium">4.8 Rating</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section id="features" className="py-20 lg:py-24">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mb-16">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-4">Features</p>
              <p className="max-w-2xl text-lg text-muted-foreground">
                Boost your grades with an AI tutor that eliminates confusion and streamlines your exam preparation.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {[
                {
                  icon: Brain,
                  title: "Adaptive AI Tutoring",
                  description: "Personalized explanations that adapt to your learning style and pace. The AI identifies gaps and reinforces weak areas.",
                },
                {
                  icon: BookOpen,
                  title: "Exam Preparation",
                  description: "Practice with past Baccalaureate questions, get instant feedback, and track your progress across all subjects.",
                },
                {
                  icon: MessageSquare,
                  title: "Interactive Chat",
                  description: "Ask questions naturally in Arabic, French, or English. Get detailed, step-by-step explanations instantly.",
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
                  className="group rounded-xl border border-border bg-card p-6 transition-all hover:shadow-md"
                >
                  <div className="mb-4 inline-flex rounded-lg bg-accent p-2.5">
                    <feature.icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="mb-2 text-base font-semibold">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it Works */}
        <section id="how-it-works" className="py-20 lg:py-24">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mb-16">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-4">How it works</p>
              <p className="max-w-2xl text-lg text-muted-foreground">
                Here&apos;s a quick look at how the AI tutor effectively helps you study.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl">
              {[
                {
                  step: "01",
                  title: "Describe what you need",
                  description: "Tell the tutor what you want to study — from daily summaries to exam practice — and it personalizes everything from the start.",
                },
                {
                  step: "02",
                  title: "Ask anything",
                  description: "Type your question in any language. The AI tutor breaks down complex topics into clear, digestible explanations with examples.",
                },
                {
                  step: "03",
                  title: "Review and master",
                  description: "Every answer is transparent. Practice with exercises, review summaries, and track your improvement over time.",
                },
              ].map((item, i) => (
                <div key={i} className="relative">
                  <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground text-sm font-bold">
                    {item.step}
                  </div>
                  <h3 className="mb-3 text-base font-semibold">{item.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{item.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Testimonials */}
        <section id="testimonials" className="py-20 lg:py-24">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mb-16">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-4">Testimonials</p>
              <p className="max-w-2xl text-lg text-muted-foreground">
                Real experiences from students who improved their grades with AI tutoring.
              </p>
            </div>

            {/* Featured testimonial */}
            <div className="rounded-xl border border-border bg-card p-8 md:p-12 mb-8 max-w-4xl">
              <p className="text-xl md:text-2xl font-medium leading-relaxed mb-8">
                &ldquo;BacPrep AI completely transformed how I prepare for exams. What used to take hours of searching through notes now happens in minutes, and I&apos;ve never felt more confident going into my Bac.&rdquo;
              </p>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-accent flex items-center justify-center">
                  <span className="text-sm font-bold text-accent-foreground">AB</span>
                </div>
                <div>
                  <p className="text-sm font-semibold">Amira B.</p>
                  <p className="text-sm text-muted-foreground">Sciences Section, Tunis</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-4xl">
              {[
                {
                  quote: "The exam prep mode gives you questions just like the real Bac and explains every answer step by step. My score went from 10 to 16.",
                  name: "Youssef M.",
                  detail: "Maths Section, Sfax",
                },
                {
                  quote: "I used the summary feature the night before my philosophy exam. It organized everything perfectly. Highly recommend!",
                  name: "Salma K.",
                  detail: "Lettres Section, Sousse",
                },
                {
                  quote: "Having an AI tutor that speaks Arabic and French is a game-changer. It understands exactly what I need for my curriculum.",
                  name: "Mohamed T.",
                  detail: "Sciences Section, Sfax",
                },
              ].map((testimonial, i) => (
                <div key={i} className="rounded-xl border border-border bg-card p-5">
                  <div className="flex gap-1 mb-3">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <Star key={s} className="h-3.5 w-3.5 fill-secondary text-secondary" />
                    ))}
                  </div>
                  <p className="text-sm text-foreground/90 leading-relaxed mb-5">
                    &ldquo;{testimonial.quote}&rdquo;
                  </p>
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-accent flex items-center justify-center">
                      <span className="text-[10px] font-bold text-accent-foreground">{testimonial.name.split(' ').map(n => n[0]).join('')}</span>
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
        <section className="py-20 lg:py-24">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="rounded-xl border border-border bg-card p-8 md:p-14 max-w-4xl">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-4">Get started</p>
              <h2 className="text-2xl md:text-3xl font-semibold mb-4">
                Ready to boost your grades?
              </h2>
              <p className="text-muted-foreground mb-8 max-w-lg">
                Start studying with AI today. It&apos;s free to get started, no credit card required.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Link href="/signup">
                  <Button className="h-10 px-6 text-base font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90">
                    <ArrowUpRight className="mr-2 h-4 w-4" />
                    Get Started
                  </Button>
                </Link>
                <Link href="/login">
                  <Button variant="outline" className="h-10 px-6 text-base font-medium rounded-lg border-border hover:bg-accent">
                    <ChevronRight className="mr-2 h-4 w-4" />
                    Learn More
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
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
