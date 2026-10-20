export const metadata = {
  title: "Terms of Service — Flipping Smiles",
};

export default function TermsPage() {
  return (
    <div className="pt-16 min-h-screen bg-white">
      <div className="max-w-2xl mx-auto px-6 py-20">
        <h1 className="font-display text-4xl font-bold text-ink mb-2">Terms of Service</h1>
        <p className="text-ink/40 text-sm mb-12">Last updated June 14, 2026</p>

        <div className="space-y-10 text-ink/70 text-sm leading-relaxed">
          <section>
            <h2 className="font-display text-xl font-semibold text-ink mb-3">1. Who can use Flipping Smiles</h2>
            <p>
              You must be at least 18 years old, or the parent or legal guardian of the child whose photo
              you upload, to use Flipping Smiles. By using our service, you confirm this is the case.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-ink mb-3">2. Previews and orders</h2>
            <p>
              Generating a preview of your child&apos;s personalized book is free and does not require
              payment. You will only be charged if you choose to order a printed copy of the book.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-ink mb-3">3. Your content</h2>
            <p>
              You retain ownership of the photo you upload. By uploading it, you grant Flipping Smiles a limited
              license to use it solely to generate your child&apos;s personalized illustrations and book, as
              described in our <a href="/privacy" className="text-brand-500 underline">Privacy Policy</a>.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-ink mb-3">4. Satisfaction guarantee</h2>
            <p>
              If you&apos;re not happy with your printed book, contact us and we&apos;ll work with you to make it
              right, including a redo or refund at our discretion.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-ink mb-3">5. Limitation of liability</h2>
            <p>
              Flipping Smiles provides illustrations generated with the help of third-party AI tools. While we
              review books before printing, illustrations are AI-assisted and may not be perfect. Flipping Smiles
              is provided &quot;as is&quot; and, to the extent permitted by law, we are not liable for indirect or
              consequential damages arising from use of the service.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-ink mb-3">6. Changes to these terms</h2>
            <p>
              We may update these terms from time to time. Continued use of Flipping Smiles after changes means you
              accept the updated terms.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-ink mb-3">7. Contact us</h2>
            <p>
              Questions about these terms? Email us at{" "}
              <a href="mailto:hello@flippingsmiles.com" className="text-brand-500 underline">hello@flippingsmiles.com</a>.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
