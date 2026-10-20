import Link from "next/link";
import { CharacterEditor } from "../CharacterEditor";

export default async function NewCharacterPage({
  searchParams,
}: {
  searchParams: Promise<{ name?: string }>;
}) {
  const { name } = await searchParams;

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <Link href="/characters" className="text-sm text-gray-400 hover:text-gray-600">← Characters</Link>
        <h1 className="text-2xl font-bold mt-1">New character</h1>
      </div>
      <CharacterEditor initialName={name} />
    </div>
  );
}
