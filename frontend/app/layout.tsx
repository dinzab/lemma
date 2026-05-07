import type { Metadata } from "next";
import { Nunito } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";
// KaTeX ships its own stylesheet — without it, math rendered by
// `@streamdown/math` (sqrt bars, fractions, exponents, etc.) appears
// as raw, unstyled spans, which on narrow viewports collapses sqrt
// vincula into full-width bars and flattens fractions / superscripts
// into inline text. Streamdown's `getStyles()` explicitly points at
// `katex/dist/katex.min.css`; consumers must import it themselves.
import "katex/dist/katex.min.css";
// Streamdown's own animation / streaming-shimmer styles. Cheap to
// include and keeps streaming markdown looking consistent with the
// upstream component.
import "streamdown/styles.css";

const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
  weight: ["200", "300", "400", "500", "600", "700", "800", "900"],
});

export const metadata: Metadata = {
  title: "BacPrep AI - Your Personal AI Study Partner",
  description: "BacPrep AI is your personal AI tutor for exam preparation.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${nunito.variable} font-body antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
