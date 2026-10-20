import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { FeedbackWidget } from "@/components/FeedbackWidget";

export const metadata: Metadata = {
  title: "Flipping Smiles Studio",
  description: "Internal tool for creating personalized storybooks",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        <header className="border-b bg-white px-6 py-3 flex items-center gap-3">
          <span className="text-2xl">📚</span>
          <span className="font-bold text-xl tracking-tight">Flipping Smiles Studio</span>
          <nav className="ml-8 flex gap-6 text-sm text-gray-600">
            <Link href="/stories" className="hover:text-gray-900">Stories</Link>
            <Link href="/characters" className="hover:text-gray-900">Characters</Link>
            <Link href="/default-characters" className="hover:text-gray-900">Default Characters</Link>
            <Link href="/orders" className="hover:text-gray-900">Orders</Link>
            <Link href="/analytics" className="hover:text-gray-900">Analytics</Link>
            <Link href="/settings" className="hover:text-gray-900">Settings</Link>
          </nav>
          <div className="ml-auto">
            <FeedbackWidget inline />
          </div>
        </header>
        <main className="p-6">{children}</main>
      </body>
    </html>
  );
}
