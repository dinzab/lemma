import { SiteHeader } from "@/components/landing/site-header";
import { HeroSection } from "@/components/landing/hero-section";
import { FeaturesSection } from "@/components/landing/features-section";
import { HowItWorks } from "@/components/landing/how-it-works";
import { UseCasesSection } from "@/components/landing/use-cases-section";
import { TestimonialsSection } from "@/components/landing/testimonials-section";
import { PricingSection } from "@/components/landing/pricing-section";
import { FaqSection } from "@/components/landing/faq-section";
import { SiteFooter } from "@/components/landing/site-footer";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader />
      <main className="flex-1">
        <HeroSection />
        <FeaturesSection />
        <HowItWorks />
        <UseCasesSection />
        <TestimonialsSection />
        <PricingSection />
        <FaqSection />
      </main>
      <SiteFooter />
    </div>
  );
}
