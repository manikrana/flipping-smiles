import { unlock } from "./actions";
import { Wordmark } from "@/components/Wordmark";

export default async function UnlockPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string }>;
}) {
  const { from = "/", error } = await searchParams;

  return (
    <div className="min-h-screen bg-cream flex items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        <Wordmark className="text-4xl text-brand-500 block mb-4" />
        <p className="text-ink/50 text-sm mb-10">
          We&apos;re in private beta. Enter the access keyword to continue.
        </p>

        <form action={unlock} className="space-y-4">
          <input type="hidden" name="from" value={from} />
          <input
            name="password"
            type="password"
            placeholder="Enter keyword"
            autoFocus
            autoComplete="off"
            className="w-full border border-ink/10 rounded-2xl px-4 py-3.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-400 text-center tracking-widest placeholder:tracking-normal placeholder:text-ink/30"
          />
          {error && (
            <p className="text-accent-500 text-sm">Incorrect keyword — try again.</p>
          )}
          <button
            type="submit"
            className="w-full bg-brand-500 hover:bg-brand-600 text-white font-semibold py-3.5 rounded-2xl text-sm transition-colors"
          >
            Enter →
          </button>
        </form>
      </div>
    </div>
  );
}
