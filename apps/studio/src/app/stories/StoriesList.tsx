"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { unarchiveStory } from "./actions";

export type StoryItem = {
  id: string;
  title: string;
  slug: string;
  age_min: number;
  age_max: number;
  price_usd: number;
  languages: string[];
  status: string;
  archived: boolean;
  page_count: number;
};

interface Props {
  stories: StoryItem[];
}

export function StoriesList({ stories }: Props) {
  const [tab, setTab] = useState<"active" | "archived">("active");
  const [revivedIds, setRevivedIds] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  const active = stories.filter((s) => !s.archived);
  const archived = stories.filter((s) => s.archived);
  const filtered = tab === "active" ? active : archived;

  function handleRevive(story: StoryItem) {
    startTransition(async () => {
      await unarchiveStory(story.id);
      setRevivedIds((s) => new Set([...s, story.id]));
    });
  }

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {(["active", "archived"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? "border-brand-500 text-brand-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t === "active" ? "Active" : "Archived"}
            <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
              {t === "active" ? active.length : archived.length}
            </span>
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-16 text-gray-400 text-sm">
          No {tab} stories.
        </div>
      )}

      {filtered.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Title</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Slug</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Ages</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Pages</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Price</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Languages</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((story) => (
                <tr key={story.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-800">{story.title}</td>
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs">{story.slug}</td>
                  <td className="px-4 py-3 text-gray-500">{story.age_min}–{story.age_max}</td>
                  <td className="px-4 py-3 text-gray-500">{story.page_count}</td>
                  <td className="px-4 py-3 text-gray-500">${story.price_usd}</td>
                  <td className="px-4 py-3 text-gray-500">{story.languages.join(", ")}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      story.status === "ready"
                        ? "bg-green-100 text-green-700"
                        : "bg-gray-100 text-gray-500"
                    }`}>
                      {story.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {tab === "active" ? (
                      <Link
                        href={`/stories/${story.id}`}
                        className="text-brand-500 hover:underline font-medium"
                      >
                        Edit
                      </Link>
                    ) : (
                      <div className="flex items-center justify-end gap-3">
                        <Link
                          href={`/stories/${story.id}`}
                          className="text-gray-400 hover:text-gray-600 text-xs"
                        >
                          View
                        </Link>
                        <button
                          onClick={() => handleRevive(story)}
                          disabled={isPending || revivedIds.has(story.id)}
                          className="text-brand-500 hover:text-brand-700 font-medium disabled:opacity-50 text-xs"
                        >
                          {revivedIds.has(story.id) ? "Revived ✓" : "Revive"}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
