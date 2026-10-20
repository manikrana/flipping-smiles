import { AnimatedSection } from "@/components/AnimatedSection";
import { Wordmark } from "@/components/Wordmark";
import Link from "next/link";

export default function AboutPage() {
  return (
    <div className="pt-16 min-h-screen">
      {/* Hero */}
      <section className="bg-cream py-24">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <AnimatedSection>
            <Wordmark className="text-6xl text-brand-500 block mb-6" />
            <h1 className="font-display text-5xl font-bold text-ink mb-6 leading-tight">
              We believe every child deserves to see themselves as a hero.
            </h1>
            <p className="text-ink/55 text-xl leading-relaxed">
              Flipping Smiles was born from a simple idea: what if the books kids grew up with starred <em>them</em>?
            </p>
          </AnimatedSection>
        </div>
      </section>

      {/* Story */}
      <section className="bg-white py-20">
        <div className="max-w-2xl mx-auto px-6 space-y-8">
          {[
            {
              heading: "Where it started",
              body: "We watched a child's face light up the first time they saw themselves illustrated in a story. Not just their name — their face, their likeness, their character. That moment of recognition and delight is why Flipping Smiles exists.",
            },
            {
              heading: "What we believe",
              body: "Representation in childhood stories matters. When children see themselves as capable, curious, and brave — even in fiction — it shapes how they see themselves in the real world. Every book we make is a love letter to one specific child.",
            },
            {
              heading: "How we do it",
              body: "We combine cutting-edge AI illustration with premium printing to create Pixar-quality personalized books. Upload a photo, pick a story, and within seconds you can preview every page of your child's personalized adventure — for free.",
            },
          ].map((section, i) => (
            <AnimatedSection key={i} delay={i * 0.1}>
              <div className="border-l-2 border-brand-500 pl-6">
                <h2 className="font-display font-semibold text-xl text-ink mb-2">{section.heading}</h2>
                <p className="text-ink/60 leading-relaxed">{section.body}</p>
              </div>
            </AnimatedSection>
          ))}
        </div>
      </section>

      {/* Values */}
      <section className="bg-cream py-20">
        <div className="max-w-5xl mx-auto px-6">
          <AnimatedSection className="text-center mb-12">
            <h2 className="font-display text-3xl font-bold text-ink">What we stand for</h2>
          </AnimatedSection>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              { icon: "🔒", title: "Privacy first", body: "Your child's photo is sacred. We use it only to create your book and delete it after." },
              { icon: "✦", title: "Quality over quantity", body: "We'd rather make fewer, better books than churn out generic content. Every story is crafted with care." },
              { icon: "💛", title: "Joy is the metric", body: "If a child doesn't light up when they open their book, we haven't done our job." },
            ].map((v, i) => (
              <AnimatedSection key={i} delay={i * 0.1}>
                <div className="bg-white rounded-3xl p-7 border border-ink/5 h-full">
                  <div className="text-3xl mb-3">{v.icon}</div>
                  <h3 className="font-display font-semibold text-lg text-ink mb-2">{v.title}</h3>
                  <p className="text-ink/55 text-sm leading-relaxed">{v.body}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-brand-500 py-20">
        <div className="max-w-2xl mx-auto px-6 text-center">
          <AnimatedSection>
            <h2 className="font-display text-3xl font-bold text-white mb-4">Ready to create your child's story?</h2>
            <p className="text-white/70 mb-8">Free preview in 30 seconds. No credit card required.</p>
            <Link href="/books" className="inline-flex bg-white text-brand-600 font-bold px-8 py-4 rounded-full hover:bg-brand-50 transition-all hover:scale-105">
              Try Now for Free →
            </Link>
          </AnimatedSection>
        </div>
      </section>
    </div>
  );
}
