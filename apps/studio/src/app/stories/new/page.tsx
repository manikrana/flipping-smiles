import Link from "next/link";
import { NewStoryForm } from "./NewStoryForm";

export default function NewStoryPage() {
  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <Link href="/stories" className="text-sm text-gray-400 hover:text-gray-600">← Stories</Link>
        <h1 className="text-2xl font-bold mt-1">New story</h1>
      </div>
      <NewStoryForm />
    </div>
  );
}
