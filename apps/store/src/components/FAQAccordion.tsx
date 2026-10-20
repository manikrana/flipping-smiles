"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

const FAQS = [
  {
    q: "Can I see the book before I pay?",
    a: "Yes — that's the whole point. Create a free preview first. See every personalized page of your child's book before we ask for a single dollar.",
  },
  {
    q: "How long does it take?",
    a: "Your free preview is ready in about 30 seconds. Once you approve it, printing and shipping takes 5–7 business days.",
  },
  {
    q: "Is my child's photo kept private?",
    a: "Absolutely. Your photo is used solely to create the book and is never shared, sold, or shown to anyone. We delete it after your order is complete.",
  },
  {
    q: "What ages are the books for?",
    a: "Our stories are designed for children aged 2–10. Each book lists its specific recommended age range on the book page.",
  },
  {
    q: "What languages are available?",
    a: "We currently offer books in English, Hindi, and Telugu. More languages are coming soon — let us know what you'd love to see!",
  },
  {
    q: "What's the print quality like?",
    a: "Premium hardcover binding, thick pages, and vibrant full-bleed printing. These are built to be read a hundred times and still look beautiful.",
  },
  {
    q: "How do I track my order?",
    a: "After placing your order, you'll receive a unique order link. You can also visit the Track Order page and enter your order ID at any time.",
  },
];

export function FAQAccordion() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="divide-y divide-ink/8">
      {FAQS.map((faq, i) => (
        <div key={i} className="py-5">
          <button
            onClick={() => setOpen(open === i ? null : i)}
            className="w-full flex items-center justify-between gap-4 text-left"
          >
            <span className="font-semibold text-ink text-base">{faq.q}</span>
            <motion.span
              animate={{ rotate: open === i ? 45 : 0 }}
              transition={{ duration: 0.2 }}
              className="shrink-0 text-brand-500 text-2xl font-light leading-none"
            >
              +
            </motion.span>
          </button>
          <AnimatePresence initial={false}>
            {open === i && (
              <motion.div
                key="content"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
              >
                <p className="pt-3 text-ink/60 text-sm leading-relaxed">{faq.a}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}
