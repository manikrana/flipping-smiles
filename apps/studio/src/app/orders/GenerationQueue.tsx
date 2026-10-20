import Link from "next/link";

export type QueueItem = {
  id: string;
  hero_name: string;
  story: { id: string; title: string } | null;
  created_at: string;
  cartoon_ready: boolean;
  cartoon_image_url: string | null;
};

export function GenerationQueue({ items }: { items: QueueItem[] }) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-amber-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          <h2 className="font-semibold text-amber-800 text-sm">Needs generation</h2>
        </div>
        <span className="text-xs text-amber-600 font-medium">
          {items.length} order{items.length !== 1 ? "s" : ""} waiting
        </span>
      </div>

      <div className="divide-y divide-amber-100">
        {items.map((item) => (
          <Link
            key={item.id}
            href={`/orders/${item.id}`}
            className="flex items-center gap-4 px-5 py-3.5 hover:bg-amber-100/60 transition-colors group"
          >
            {/* Thumbnail */}
            <div className="w-10 h-10 rounded-lg overflow-hidden bg-amber-100 shrink-0 border border-amber-200">
              {item.cartoon_image_url ? (
                <img src={item.cartoon_image_url} alt={item.hero_name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-amber-300 text-lg">?</div>
              )}
            </div>

            {/* Details */}
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-gray-900 text-sm truncate">{item.hero_name}</p>
              <p className="text-xs text-gray-500 truncate">{item.story?.title ?? "Unknown book"}</p>
            </div>

            {/* Character status */}
            <div className="shrink-0 text-right">
              {item.cartoon_ready ? (
                <span className="text-xs font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                  Character ready
                </span>
              ) : (
                <span className="text-xs font-medium text-orange-700 bg-orange-100 px-2 py-0.5 rounded-full">
                  Needs character
                </span>
              )}
              <p className="text-xs text-gray-400 mt-0.5">
                {new Date(item.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </p>
            </div>

            <span className="text-gray-300 group-hover:text-gray-500 transition-colors text-sm">→</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
