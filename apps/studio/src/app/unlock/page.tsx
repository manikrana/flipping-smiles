import { unlock } from "./actions";

export default async function UnlockPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string }>;
}) {
  const { from = "/", error } = await searchParams;

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        <div className="text-4xl mb-4">📚</div>
        <h1 className="text-xl font-semibold text-white mb-1">Flipping Smiles Studio</h1>
        <p className="text-gray-500 text-sm mb-8">Enter your access keyword to continue.</p>

        <form action={unlock} className="space-y-3">
          <input type="hidden" name="from" value={from} />
          <input
            name="password"
            type="password"
            placeholder="Access keyword"
            autoFocus
            autoComplete="off"
            className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-gray-500 text-center tracking-widest placeholder:tracking-normal placeholder:text-gray-600"
          />
          {error && (
            <p className="text-red-400 text-sm">Incorrect keyword.</p>
          )}
          <button
            type="submit"
            className="w-full bg-gray-700 hover:bg-gray-600 text-white font-medium py-3 rounded-xl text-sm transition-colors"
          >
            Enter
          </button>
        </form>
      </div>
    </div>
  );
}
