import { FeaturedBooksRow, type FeaturedBook } from "./FeaturedBooksRow";

// Shared by every "show the real back cover" preview surface (CoverEditor,
// PreviewPanel, OrderBookPreview) so the back-cover ad content (leading
// text, featured books, QR codes, company name) looks and positions the
// same everywhere, matching the real print layout in lib/layout.ts's
// renderCoverSpread. The back-cover art itself is now fully clean/
// uncluttered (see lib/coverPrompt.ts) -- everything here is a real, precise
// overlay, not baked into the AI art.
//
// Top group: a leading-text pill stacked directly above a blurred panel
// hugging just the featured-books thumbnail row (width fit to content, not a
// fixed fraction of the back cover, so it wraps 2 books as tightly as 4).
// Footer: two QR codes, Instagram bottom-left and website bottom-right --
// each one solid white vertical card (QR on top, label below), not blurred,
// since a QR needs a solid, high-contrast backing to stay scannable -- and
// the company name centered between them, on its own small pill for the
// same legibility reason. The leading text, QR labels, and company name all
// use the story's own cover font (fontFamily), matching the ingrained
// front-cover typography, not a fixed brand font.
//
// Render inside a `position: relative` container with `containerType: "size"`
// set so the cqh units below resolve against that container's own box, not
// the page.

export type BackCoverOverlayProps = {
  featuredBooks: FeaturedBook[];
  websiteQrUrl: string | null;
  instagramQrUrl: string | null;
  companyName: string | null;
  leadingText: string | null;
  fontFamily: string;
  /** True in the editing form, before a real QR image has been rendered server-side -- shows a placeholder box instead of an <img>. */
  qrPlaceholder?: boolean;
};

function QrTile({ url, label, fontFamily, placeholder }: { url: string; label: string; fontFamily: string; placeholder?: boolean }) {
  return (
    <div className="bg-white rounded-lg overflow-hidden flex flex-col items-center" style={{ width: "14cqh" }}>
      <div className="w-full flex items-center justify-center p-[6%]" style={{ aspectRatio: "1/1" }}>
        {placeholder ? (
          <span className="text-gray-400 font-mono" style={{ fontSize: "3.2cqh" }}>QR</span>
        ) : (
          <img src={url} alt={`${label} QR code`} className="w-full h-full" />
        )}
      </div>
      <span className="w-full text-center pb-[8%]" style={{ fontFamily, fontSize: "3cqh", color: "#1c1c1e" }}>
        {label}
      </span>
    </div>
  );
}

export function BackCoverOverlay({ featuredBooks, websiteQrUrl, instagramQrUrl, companyName, leadingText, fontFamily, qrPlaceholder }: BackCoverOverlayProps) {
  const hasQr = !!websiteQrUrl || !!instagramQrUrl;
  const hasTopGroup = featuredBooks.length > 0 || !!leadingText;
  if (!hasTopGroup && !hasQr && !companyName) return null;

  return (
    <>
      {hasTopGroup && (
        <div
          className="absolute top-[22%] left-1/2 flex flex-col items-center gap-[1.5cqh]"
          style={{ transform: "translateX(-50%)", maxWidth: "92%" }}
        >
          {leadingText && (
            <span
              className="rounded-lg px-[1.4cqh] py-[0.5cqh] whitespace-nowrap"
              style={{ fontFamily, fontSize: "4.2cqh", color: "#1c1c1e", backgroundColor: "rgba(255,255,255,0.85)" }}
            >
              {leadingText}
            </span>
          )}
          {featuredBooks.length > 0 && (
            <div
              className="rounded-xl flex flex-col items-center px-3 py-3"
              style={{ backgroundColor: "rgba(255,255,255,0.55)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
            >
              <FeaturedBooksRow books={featuredBooks} />
            </div>
          )}
        </div>
      )}

      {(hasQr || companyName) && (
        <div className="absolute left-[6%] right-[6%] bottom-[6%] flex items-end justify-between gap-2">
          {instagramQrUrl ? <QrTile url={instagramQrUrl} label="Follow us" fontFamily={fontFamily} placeholder={qrPlaceholder} /> : <span />}
          {companyName ? (
            <span
              className="rounded-lg px-[1.4cqh] py-[0.4cqh] whitespace-nowrap"
              style={{ fontFamily, fontSize: "3.6cqh", color: "#1c1c1e", backgroundColor: "rgba(255,255,255,0.85)" }}
            >
              {companyName}
            </span>
          ) : (
            <span />
          )}
          {websiteQrUrl ? <QrTile url={websiteQrUrl} label="Website" fontFamily={fontFamily} placeholder={qrPlaceholder} /> : <span />}
        </div>
      )}
    </>
  );
}
