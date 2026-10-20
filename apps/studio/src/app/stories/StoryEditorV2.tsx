"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { addStoryPage, deleteStoryPage } from "./actions";
import { setStoryStatus } from "./book/actions";
import { StoryInfoPanel } from "./StoryInfoPanel";
import { PrintPanel } from "./PrintPanel";
import { StoryPagePanel, type PageSummary } from "./StoryPagePanel";
import { FrontSpreadPanel } from "./FrontSpreadPanel";
import { BrandPagePanel } from "./BrandPagePanel";
import { EndPagePanel } from "./EndPagePanel";
import { BackCoverPanel } from "./BackCoverPanel";
import { CoverPanel } from "./CoverPanel";
import { PreviewPanel } from "./PreviewPanel";
import { PublishPanel } from "./PublishPanel";
import type {
  StoryRow,
  StoryPageRow,
  CastCharacterRow,
  PrintProviderTrimSizeRow,
  PrintProviderRow,
  TextStyle,
  TextPanelBg,
} from "@/lib/supabase/types";
import { DEFAULT_TEXT_STYLE, DEFAULT_TEXT_PANEL_BG } from "@/lib/supabase/types";
import { GOOGLE_FONTS_URL } from "@/lib/fonts";

interface Props {
  story: StoryRow;
  pages: StoryPageRow[];
  allCharacters: CastCharacterRow[];
  initialPageCast: Record<string, string[]>;
  trimSizes: PrintProviderTrimSizeRow[];
  printProviders: PrintProviderRow[];
}

type TopTab = "details" | "pages" | "print" | "preview" | "publish";
type SidebarItem = "front-endpaper" | "brand" | "front-spread" | "end" | "back-endpaper" | "spine" | "cover" | "back-cover" | string; // string = page ID

const TOP_TABS: { id: TopTab; label: string }[] = [
  { id: "details", label: "Details" },
  { id: "print",   label: "Print" },
  { id: "pages",   label: "Pages" },
  { id: "preview", label: "Preview" },
  { id: "publish", label: "Publish" },
];

export function StoryEditorV2({
  story: initialStory,
  pages: initialPages,
  allCharacters,
  initialPageCast,
  trimSizes,
  printProviders,
}: Props) {
  const [, startTransition] = useTransition();
  const [topTab, setTopTab] = useState<TopTab>("details");

  // Shared print state — lifted so PrintPanel edits immediately reflect in the page preview
  const [textStyle, setTextStyle] = useState<TextStyle>(
    (initialStory.text_style as TextStyle | null) ?? DEFAULT_TEXT_STYLE
  );
  const [panelBg, setPanelBg] = useState<TextPanelBg>(
    (initialStory.text_panel_bg as TextPanelBg | null) ?? DEFAULT_TEXT_PANEL_BG
  );
  const [layoutType, setLayoutType] = useState<"overlay_bottom" | "split_image_left" | "split_image_right" | "spread_left" | "spread_right" | "spread_left_clean" | "spread_right_clean">(
    initialStory.layout_type ?? "split_image_left"
  );
  const [pages, setPages] = useState<PageSummary[]>(
    initialPages.map((p) => ({
      id: p.id,
      page_number: p.page_number,
      image_url: p.image_url,
      image_url_girl: p.image_url_girl,
      image_approved: p.image_approved,
      preview_eligible: p.preview_eligible ?? false,
      hero_boy_character_id: p.hero_boy_character_id ?? null,
      hero_girl_character_id: p.hero_girl_character_id ?? null,
      text_image_url: p.text_image_url,
      text_bg_url: p.text_bg_url ?? null,
      text: p.text,
      scene_prompt: p.scene_prompt,
      scene_prompt_girl: p.scene_prompt_girl ?? null,
      continuity_reference_page_id: p.continuity_reference_page_id ?? null,
      vertical_align: (p.vertical_align as "top" | "center" | "bottom" | null) ?? null,
      character_count_verified: p.character_count_verified ?? null,
    }))
  );
  const [selected, setSelected] = useState<SidebarItem>(
    initialPages.length > 0 ? initialPages[0].id : "end-page"
  );
  const [storyStatus, setStoryStatusState] = useState(initialStory.status);
  const [addingPage, setAddingPage] = useState(false);
  const [sidebarError, setSidebarError] = useState<string | null>(null);

  function handlePageUpdate(pageId: string, updates: Partial<PageSummary>) {
    setPages((prev) => prev.map((p) => (p.id === pageId ? { ...p, ...updates } : p)));
  }

  async function handleAddPage() {
    setAddingPage(true);
    setSidebarError(null);
    try {
      const lastPageNum =
        pages.length > 0 ? Math.max(...pages.map((p) => p.page_number)) : 0;
      const newPage = await addStoryPage(initialStory.id, lastPageNum);
      const summary: PageSummary = {
        id: newPage.id,
        page_number: newPage.page_number,
        image_url: newPage.image_url ?? null,
        image_url_girl: newPage.image_url_girl ?? null,
        image_approved: newPage.image_approved ?? false,
        preview_eligible: newPage.preview_eligible ?? false,
        hero_boy_character_id: newPage.hero_boy_character_id ?? null,
        hero_girl_character_id: newPage.hero_girl_character_id ?? null,
        text_image_url: newPage.text_image_url ?? null,
        text_bg_url: newPage.text_bg_url ?? null,
        text: newPage.text ?? "",
        scene_prompt: newPage.scene_prompt ?? "",
        scene_prompt_girl: newPage.scene_prompt_girl ?? null,
        continuity_reference_page_id: newPage.continuity_reference_page_id ?? null,
        vertical_align: (newPage.vertical_align as "top" | "center" | "bottom" | null) ?? null,
        character_count_verified: newPage.character_count_verified ?? null,
      };
      setPages((prev) => [...prev, summary]);
      setSelected(newPage.id);
    } catch (e) {
      setSidebarError(e instanceof Error ? e.message : String(e));
    } finally {
      setAddingPage(false);
    }
  }

  async function handleDeletePage(pageId: string) {
    if (!confirm("Delete this page? This cannot be undone.")) return;
    setSidebarError(null);
    try {
      await deleteStoryPage(initialStory.id, pageId);
      setPages((prev) => {
        const filtered = prev.filter((p) => p.id !== pageId);
        return filtered.map((p, i) => ({ ...p, page_number: i + 1 }));
      });
      setSelected("end-page");
    } catch (e) {
      setSidebarError(e instanceof Error ? e.message : String(e));
    }
  }

  const selectedPage =
    selected !== "end-page" && selected !== "back-cover"
      ? pages.find((p) => p.id === selected)
      : null;

  function sidebarItemClass(id: SidebarItem) {
    return `w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors ${
      selected === id
        ? "bg-brand-50 text-brand-700 font-medium"
        : "text-gray-600 hover:bg-gray-50"
    }`;
  }

  function topTabClass(tab: TopTab) {
    return `px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
      topTab === tab
        ? "border-brand-500 text-brand-700"
        : "border-transparent text-gray-500 hover:text-gray-700"
    }`;
  }

  // Derive publish-related data
  const publishStory = { ...initialStory, status: storyStatus };
  const publishPages = pages.map((p) => ({
    ...p,
    story_id: initialStory.id,
    default_character_description: null,
    created_at: "",
  }));

  // Sidebar for the Pages tab
  const PagesSidebar = (
    <aside className="w-52 flex-shrink-0 border-r border-gray-200 bg-white flex flex-col overflow-hidden">
      {/* Book pages — top. Print order: front endpaper, brand page, dedication & title, then story pages. */}
      <div className="border-b border-gray-100 p-2 space-y-0.5">
        <button onClick={() => setSelected("front-endpaper")} className={sidebarItemClass("front-endpaper")}>
          <span className="text-base shrink-0">📄</span>
          <span className="truncate text-xs">Front Endpaper</span>
        </button>
        <button onClick={() => setSelected("brand")} className={sidebarItemClass("brand")}>
          <span className="text-base shrink-0">📄</span>
          <span className="truncate text-xs">Brand Page</span>
        </button>
        <button onClick={() => setSelected("front-spread")} className={sidebarItemClass("front-spread")}>
          <span className="text-base shrink-0">📖</span>
          <span className="truncate text-xs">Dedication &amp; Title</span>
        </button>
      </div>

      {/* Story pages list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5 min-h-0">
        {pages.map((page) => (
          <button
            key={page.id}
            onClick={() => setSelected(page.id)}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-sm transition-colors ${
              selected === page.id
                ? "bg-brand-50 text-brand-700"
                : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            <div className="w-8 h-8 rounded shrink-0 overflow-hidden border border-gray-200 bg-gray-100">
              {page.image_url ? (
                <img src={page.image_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-300 text-xs">?</div>
              )}
            </div>
            <span className={`text-xs truncate flex-1 ${selected === page.id ? "font-medium" : ""}`}>
              P{page.page_number}
            </span>
            <div className="flex items-center gap-0.5 shrink-0">
              {page.image_approved && (
                <span className="text-green-500 text-xs" title="Image approved">✓</span>
              )}
              {page.text_image_url && (
                <span className="text-blue-400 text-xs" title="Text composited">T</span>
              )}
            </div>
          </button>
        ))}

        <button
          onClick={handleAddPage}
          disabled={addingPage}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-brand-600 hover:bg-brand-50 transition-colors disabled:opacity-50 mt-1"
        >
          <span className="text-base shrink-0">+</span>
          <span className="text-xs">{addingPage ? "Adding…" : "Add page"}</span>
        </button>
      </div>

      {/* Fixed bottom. Print order: end page, back endpaper, then exterior cover settings. */}
      <div className="border-t border-gray-100 p-2 space-y-0.5">
        <button onClick={() => setSelected("end")} className={sidebarItemClass("end")}>
          <span className="text-base shrink-0">📖</span>
          <span className="truncate text-xs">End Page</span>
        </button>
        <button onClick={() => setSelected("back-endpaper")} className={sidebarItemClass("back-endpaper")}>
          <span className="text-base shrink-0">📄</span>
          <span className="truncate text-xs">Back Endpaper</span>
        </button>
        <button onClick={() => setSelected("back-cover")} className={sidebarItemClass("back-cover")}>
          <span className="text-base shrink-0">📖</span>
          <span className="truncate text-xs">Back Cover</span>
        </button>
        <button onClick={() => setSelected("spine")} className={sidebarItemClass("spine")}>
          <span className="text-base shrink-0">▌</span>
          <span className="truncate text-xs">Spine</span>
        </button>
        <button onClick={() => setSelected("cover")} className={sidebarItemClass("cover")}>
          <span className="text-base shrink-0">🖼️</span>
          <span className="truncate text-xs">Front Cover</span>
        </button>

        {sidebarError && (
          <p className="text-xs text-red-500 px-2 pt-1 leading-tight">{sidebarError}</p>
        )}
      </div>
    </aside>
  );

  return (
    <div className="flex flex-col h-[calc(100vh-73px)] -m-6 overflow-hidden">
      {/* Google Fonts — always in DOM so custom fonts render regardless of active tab */}
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="stylesheet" href={GOOGLE_FONTS_URL} />

      {/* ── Top tab bar ──────────────────────────────────── */}
      <div className="flex items-center border-b border-gray-200 bg-white px-2 shrink-0">
        <Link href="/stories" className="text-sm text-gray-400 hover:text-gray-600 px-2 mr-1 shrink-0">
          ← Stories
        </Link>
        <div className="w-px h-5 bg-gray-200 mr-1 shrink-0" />
        {TOP_TABS.map((tab) => (
          <button key={tab.id} onClick={() => setTopTab(tab.id)} className={topTabClass(tab.id)}>
            {tab.label}
          </button>
        ))}

        {/* Right side: live badge + step nav */}
        <div className="ml-auto flex items-center gap-2 pr-2">
          {storyStatus === "ready" && (
            <span className="text-xs font-semibold text-green-600 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
              🟢 Live
            </span>
          )}
          {(() => {
            const currentIdx = TOP_TABS.findIndex((t) => t.id === topTab);
            return (
              <>
                <button
                  onClick={() => setTopTab(TOP_TABS[currentIdx - 1].id)}
                  disabled={currentIdx === 0}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:pointer-events-none transition-all"
                >
                  ← Back
                </button>
                <button
                  onClick={() => setTopTab(TOP_TABS[currentIdx + 1].id)}
                  disabled={currentIdx === TOP_TABS.length - 1}
                  className="px-3 py-1.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium disabled:opacity-30 disabled:pointer-events-none transition-all"
                >
                  Next →
                </button>
              </>
            );
          })()}
        </div>
      </div>

      {/* ── Details tab ──────────────────────────────────── */}
      {topTab === "details" && (
        <div className="flex-1 overflow-y-auto bg-gray-50 p-6">
          <StoryInfoPanel story={initialStory} />
        </div>
      )}

      {/* ── Pages tab ────────────────────────────────────── */}
      {topTab === "pages" && (
        <div className="flex flex-1 overflow-hidden min-h-0">
          {PagesSidebar}
          <main className="flex-1 overflow-y-auto bg-gray-50 p-6 min-w-0">
            {selected === "front-endpaper" && (
              <div className="max-w-lg space-y-4">
                <h2 className="text-lg font-semibold text-gray-800">Front Endpaper</h2>
                <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
                  <p className="text-sm text-gray-600">
                    Left-hand page of the first interior spread, right after the front cover. Always blank.
                  </p>
                  <div className="bg-gray-50 rounded-lg px-4 py-3 text-sm text-gray-500 space-y-1.5">
                    <p>
                      <span className="font-medium text-gray-700">Why:</span> some of Gelato&apos;s production
                      partners glue this leaf directly to the inside cover board, so printed content here risks
                      being unpredictably hidden depending on which partner fulfills a given order.
                    </p>
                    <p><span className="font-medium text-gray-700">Color:</span> #f5f0e8 (flat, no text or image).</p>
                  </div>
                </div>
              </div>
            )}
            {selected === "brand" && <BrandPagePanel story={initialStory} />}
            {selected === "front-spread" && <FrontSpreadPanel story={initialStory} />}
            {selected === "end" && <EndPagePanel story={initialStory} />}
            {selected === "back-endpaper" && (
              <div className="max-w-lg space-y-4">
                <h2 className="text-lg font-semibold text-gray-800">Back Endpaper</h2>
                <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
                  <p className="text-sm text-gray-600">
                    Right-hand page of the last interior spread, facing the End Page, right before the back
                    cover. Always blank.
                  </p>
                  <div className="bg-gray-50 rounded-lg px-4 py-3 text-sm text-gray-500 space-y-1.5">
                    <p>
                      <span className="font-medium text-gray-700">Why:</span> some of Gelato&apos;s production
                      partners glue this leaf directly to the inside cover board, so printed content here risks
                      being unpredictably hidden depending on which partner fulfills a given order.
                    </p>
                    <p><span className="font-medium text-gray-700">Color:</span> #f5f0e8 (flat, no text or image).</p>
                  </div>
                </div>
              </div>
            )}
            {selected === "cover" && <CoverPanel story={initialStory} pages={pages} allCharacters={allCharacters} />}
            {selected === "spine" && (
              <div className="max-w-lg space-y-4">
                <h2 className="text-lg font-semibold text-gray-800">Spine</h2>
                <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
                  <p className="text-sm text-gray-600">The spine is auto-colored from your front cover.</p>
                  <div className="bg-gray-50 rounded-lg px-4 py-3 text-sm text-gray-500 space-y-1.5">
                    <p><span className="font-medium text-gray-700">Title:</span> {initialStory.title}</p>
                    <p><span className="font-medium text-gray-700">Text:</span> Omitted when Gelato's spine is under 10mm wide — too narrow to fit legibly.</p>
                    <p><span className="font-medium text-gray-700">Color:</span> Matches front cover.</p>
                  </div>
                </div>
              </div>
            )}
            {selected === "back-cover" && <BackCoverPanel story={initialStory} />}

            {selectedPage && (
              <StoryPagePanel
                key={selectedPage.id}
                page={selectedPage}
                story={initialStory}
                textStyle={textStyle}
                panelBg={panelBg}
                layoutType={layoutType}
                allCharacters={allCharacters}
                initialPageCast={initialPageCast[selectedPage.id] ?? []}
                allPages={pages}
                onUpdate={(updates) => handlePageUpdate(selectedPage.id, updates)}
                onDelete={() => handleDeletePage(selectedPage.id)}
              />
            )}

            {!selectedPage && selected !== "front-endpaper" && selected !== "brand" && selected !== "front-spread" && selected !== "end" && selected !== "back-endpaper" && selected !== "spine" && selected !== "cover" && selected !== "back-cover" && (
              <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
                Page not found. It may have been deleted.
              </div>
            )}
          </main>
        </div>
      )}

      {/* ── Print tab ────────────────────────────────────── */}
      {topTab === "print" && (
        <div className="flex-1 overflow-y-auto bg-gray-50 p-6">
          <PrintPanel
            story={initialStory}
            trimSizes={trimSizes}
            printProviders={printProviders}
            textStyle={textStyle}
            panelBg={panelBg}
            layoutType={layoutType}
            onTextStyleChange={setTextStyle}
            onPanelBgChange={setPanelBg}
            onLayoutTypeChange={setLayoutType}
          />
        </div>
      )}

      {/* ── Preview tab ──────────────────────────────────── */}
      {topTab === "preview" && (
        <div className="flex-1 overflow-hidden min-h-0">
          <PreviewPanel
            story={initialStory}
            pages={initialPages}
            textStyle={textStyle}
            panelBg={panelBg}
            layoutType={layoutType}
          />
        </div>
      )}

      {/* ── Publish tab ──────────────────────────────────── */}
      {topTab === "publish" && (
        <div className="flex-1 overflow-y-auto bg-gray-50 p-6">
          <PublishPanel
            story={publishStory}
            pages={publishPages}
          />
        </div>
      )}

    </div>
  );
}
