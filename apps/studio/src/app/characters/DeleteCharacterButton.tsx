"use client";

import { deleteCharacter } from "./actions";

export function DeleteCharacterButton({ id, name }: { id: string; name: string }) {
  async function handleClick(e: React.MouseEvent) {
    e.preventDefault(); // don't navigate to character page
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    await deleteCharacter(id);
  }

  return (
    <button
      onClick={handleClick}
      className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity bg-red-500 hover:bg-red-600 text-white text-xs font-medium px-2 py-1 rounded-md"
    >
      Delete
    </button>
  );
}
