import { AnimatedSection } from "@/components/AnimatedSection";
import { FAQAccordion } from "@/components/FAQAccordion";
import Link from "next/link";

export default function FAQPage() {
  return (
    <div className="pt-16 min-h-screen">
      <section className="bg-cream py-20">
        <div className="max-w-3xl mx-auto px-6">
          <AnimatedSection className="text-center mb-14">
            <p className="text-sm font-semibold text-brand-600 uppercase tracking-widest mb-3">Help Center</p>
            <h1 className="font-display text-5xl font-bold text-ink mb-4">Frequently asked questions</h1>
            <p className="text-ink/50 text-lg">Everything you need to know before creating your child&apos;s book.</p>
          </AnimatedSection>

          <AnimatedSection>
            <div className="bg-white rounded-3xl p-8 shadow-card">
              <FAQAccordion />
            </div>
          </AnimatedSection>

          <AnimatedSection className="text-center mt-12">
            <p className="text-ink/50 mb-4">Still have questions?</p>
            <a
              href="mailto:hello@flippingsmiles.com"
              className="inline-flex items-center gap-2 bg-ink text-cream font-semibold px-6 py-3 rounded-full text-sm hover:bg-ink/80 transition-colors"
            >
              Email us →
            </a>
          </AnimatedSection>
        </div>
      </section>

      <section className="bg-brand-500 py-16">
        <div className="max-w-xl mx-auto px-6 text-center">
          <AnimatedSection>
            <h2 className="font-display text-3xl font-bold text-white mb-4">Ready to create your child&apos;s book?</h2>
            <Link href="/books" className="inline-flex bg-white text-brand-600 font-bold px-8 py-4 rounded-full hover:bg-brand-50 transition-all hover:scale-105">
              Try Now for Free →
            </Link>
          </AnimatedSection>
        </div>
      </section>
    </div>
  );
}
