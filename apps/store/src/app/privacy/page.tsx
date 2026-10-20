export const metadata = {
  title: "Privacy Policy — Flipping Smiles",
};

export default function PrivacyPage() {
  return (
    <div className="pt-16 min-h-screen bg-white">
      <div className="max-w-2xl mx-auto px-6 py-20">
        <h1 className="font-display text-4xl font-bold text-ink mb-2">Privacy Policy</h1>
        <p className="text-ink/40 text-sm mb-12">Last updated June 14, 2026</p>

        <div className="space-y-10 text-ink/70 text-sm leading-relaxed">
          <section>
            <h2 className="font-display text-xl font-semibold text-ink mb-3">1. What we collect</h2>
            <p className="mb-3">When you create a book on Flipping Smiles, we collect:</p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>A photo of your child, which you upload</li>
              <li>Your child&apos;s first name and gender, used to personalize the story</li>
              <li>Your preferred story language</li>
              <li>Your email, shipping address, and payment details, if you place an order</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-ink mb-3">2. How your child&apos;s photo is used</h2>
            <p className="mb-3">
              Your child&apos;s photo is used solely to generate a personalized illustrated character for their
              book. To do this, the photo is sent to our AI image-generation provider (currently Google
              Gemini) to create a cartoon-style version of your child, which is then placed into the
              illustrations throughout the story.
            </p>
            <p>
              We do not use your child&apos;s photo for advertising, marketing, or any purpose other than
              creating your book. We do not sell or share your child&apos;s photo with any third party except
              the AI provider used to generate the illustration, and our printing partner if you place an
              order.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-ink mb-3">3. Consent</h2>
            <p>
              By uploading a photo, you confirm that you are the parent or legal guardian of the child
              pictured, or that you have obtained permission from their parent or legal guardian to upload
              the photo on their behalf (for example, as a relative or friend ordering a gift). You also
              confirm that you consent, or have obtained consent, for the photo to be processed as
              described in this policy. If you cannot obtain this permission, please do not upload a
              child&apos;s photo.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-ink mb-3">4. How long we keep data</h2>
            <p className="mb-3">
              We retain the uploaded photo and the generated illustrations for as long as needed to create
              your book, fulfill your order, and provide support if something goes wrong with your order
              (such as a reprint).
            </p>
            <p>
              We are actively working to minimize how long original photos are retained, and to delete them
              automatically once the personalized illustration has been created. If you would like your
              photo and account data deleted sooner, contact us at the email below and we will remove it.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-ink mb-3">5. Third parties we use</h2>
            <ul className="list-disc pl-5 space-y-1.5">
              <li><strong>Google Gemini</strong> — to generate cartoon illustrations from your child&apos;s photo</li>
              <li><strong>Supabase</strong> — to securely store data and files</li>
              <li><strong>Stripe</strong> — to process payments (we never see or store your card details)</li>
              <li>A printing and fulfillment partner — to print and ship your physical book</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-ink mb-3">6. Your rights</h2>
            <p>
              You can ask us to access, correct, or delete any personal data we hold about you or your
              child at any time, by emailing us at the address below. We will respond promptly.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-ink mb-3">7. Children&apos;s privacy</h2>
            <p>
              Flipping Smiles is a service for parents and guardians, not for use directly by children. We rely on
              the uploading parent or guardian to provide consent on behalf of their child, as described in
              Section 3.
            </p>
          </section>

          <section>
            <h2 className="font-display text-xl font-semibold text-ink mb-3">8. Contact us</h2>
            <p>
              If you have questions about this policy or want to exercise your privacy rights, email us at{" "}
              <a href="mailto:hello@flippingsmiles.com" className="text-brand-500 underline">hello@flippingsmiles.com</a>.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
