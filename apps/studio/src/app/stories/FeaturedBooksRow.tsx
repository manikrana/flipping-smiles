// Shared by every "show the real back cover" preview surface (CoverEditor,
// PreviewPanel, OrderBookPreview, BackCoverPanel) so the "Have you read?"
// thumbnail row looks and sizes the same everywhere, matching the real print
// layout in lib/layout.ts's renderCoverSpread (row of square front-cover-zone
// thumbnails -- just the art, no caption, since every book's own title is
// now ingrained in its own cover art, not repeated here as a label). Render
// inside a container with `containerType: "size"` set so the cqh units below
// resolve against that container's own box, not the page -- every real
// container this renders in (a back-cover content panel) is close enough to
// square that cqh doubles as a stand-in for cqw here.

export type FeaturedBook = { title: string; coverUrl: string | null };

// Capped at 20cqh to match lib/layout.ts's renderCoverSpread (thumbSize capped
// at 20% of the back panel's height) -- keeping the two in proportional sync
// also keeps the panel short enough to never collide with the QR footer
// beneath it (see BackCoverOverlay.tsx).
const MAX_THUMB_CQH = 20;
const GAP_CQH = 4;

export function FeaturedBooksRow({ books }: { books: FeaturedBook[] }) {
  const shown = books.slice(0, 4);
  const n = shown.length;
  const thumbCqh = Math.min(MAX_THUMB_CQH, (92 - GAP_CQH * (n - 1)) / n);

  return (
    <div className="flex justify-center items-start" style={{ gap: `${GAP_CQH}cqh` }}>
      {shown.map((book, i) => (
        <div key={i} className="rounded-md overflow-hidden shrink-0 bg-white/40" style={{ width: `${thumbCqh}cqh`, aspectRatio: "1/1" }}>
          {book.coverUrl && (
            <img
              src={book.coverUrl}
              alt={book.title}
              className="w-full h-full object-cover"
              style={{ objectPosition: "right center", transform: "scale(1.13)", transformOrigin: "right center" }}
            />
          )}
        </div>
      ))}
    </div>
  );
}
