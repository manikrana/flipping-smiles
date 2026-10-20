#!/usr/bin/env npx tsx
/**
 * Feedback agent — fetches the oldest open feedback item from Supabase,
 * feeds it to Claude Code, then commits and pushes the result.
 *
 * Usage:
 *   npx tsx scripts/process-feedback.ts
 *   npx tsx scripts/process-feedback.ts --dry-run   # print prompt, don't run claude
 */

import { createClient } from "@supabase/supabase-js";
import { execSync, spawnSync } from "child_process";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const dryRun = process.argv.includes("--dry-run");

async function main() {
  const { data: items, error } = await supabase
    .from("feedback")
    .select("*")
    .eq("status", "open")
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) throw error;

  if (!items?.length) {
    console.log("No open feedback items.");
    return;
  }

  const item = items[0];
  const siteDir = item.site === "store" ? "apps/store" : "apps/studio";

  console.log(`\nProcessing [${item.type}] "${item.title}" (${item.id})\n`);

  const prompt = `You are working on the Kitabee monorepo at the current directory.

A beta user submitted the following ${item.type === "bug" ? "bug report" : "feature request"}:

Type: ${item.type}
Title: ${item.title}
Description: ${item.description}
Site: ${item.site} (code in ${siteDir}/)
${item.url ? `URL where it occurred: ${item.url}` : ""}

Please investigate the codebase and ${item.type === "bug" ? "fix the bug" : "implement the feature"}.

Requirements:
- Make all necessary code changes
- Ensure TypeScript types are correct (run: npx pnpm@9.15.4 run type-check)
- Commit with a descriptive message referencing the feedback: "feedback(${item.id.slice(0, 8)}): ${item.title}"
- Push to main

If the request is unclear, ambiguous, or would require changes beyond the codebase (e.g. infrastructure, payments), leave the code unchanged and explain why in your response.`;

  if (dryRun) {
    console.log("--- PROMPT ---\n");
    console.log(prompt);
    console.log("\n--- END PROMPT (dry run, not executing) ---");
    return;
  }

  // Mark in progress
  await supabase.from("feedback").update({ status: "in_progress" }).eq("id", item.id);

  try {
    const result = spawnSync("claude", ["--print", "-p", prompt], {
      stdio: "inherit",
      encoding: "utf-8",
      timeout: 10 * 60 * 1000, // 10 min
    });

    if (result.status !== 0) {
      throw new Error(`claude exited with code ${result.status}`);
    }

    await supabase.from("feedback").update({ status: "done" }).eq("id", item.id);
    console.log(`\nDone. Feedback ${item.id} marked as done.`);
  } catch (err) {
    await supabase.from("feedback").update({ status: "open" }).eq("id", item.id);
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
