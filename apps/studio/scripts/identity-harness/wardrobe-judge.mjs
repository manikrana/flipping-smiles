#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { GoogleGenerativeAI } from "@google/generative-ai";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const STUDIO_DIR = path.resolve(SCRIPT_DIR, "../..");

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--sheet") out.sheet = argv[++i];
    else if (argv[i] === "--scene") out.scene = argv[++i];
    else if (argv[i] === "--confirm-spend") out.confirmSpend = true;
    else if (argv[i] !== "--") throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return out;
}

function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file, "utf8").split(/\r?\n/).flatMap((raw) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return [];
    const at = line.indexOf("=");
    if (at < 1) return [];
    let value = line.slice(at + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    return [[line.slice(0, at).trim(), value]];
  }));
}

function inlineFile(file) {
  const ext = path.extname(file).toLowerCase();
  const mimeType = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "image/png";
  return { inlineData: { data: fs.readFileSync(file).toString("base64"), mimeType } };
}

const options = args(process.argv.slice(2));
if (!options.sheet || !options.scene || !options.confirmSpend) {
  throw new Error("Usage: wardrobe-judge.mjs --sheet FILE --scene FILE --confirm-spend");
}
for (const file of [options.sheet, options.scene]) {
  if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`);
}

const env = { ...readEnvFile(path.join(STUDIO_DIR, ".env.local")), ...process.env };
if (!env.GOOGLE_GEMINI_API_KEY) throw new Error("GOOGLE_GEMINI_API_KEY is not configured");
const model = new GoogleGenerativeAI(env.GOOGLE_GEMINI_API_KEY).getGenerativeModel({
  model: "gemini-3.1-flash-image",
  systemInstruction: "You are a strict wardrobe-continuity judge for a children's book. Compare the hero's outfit in a rendered scene with the authoritative full-body costume sheet. Judge garment identity, not art-style or lighting differences.",
  generationConfig: { responseModalities: ["TEXT"] },
});
const result = await model.generateContent([
  inlineFile(path.resolve(options.sheet)),
  "AUTHORITATIVE COSTUME SHEET above. It is the sole wardrobe source. Record the garment types, dominant colours, patterns or graphics, bottoms, footwear, and accessories shown across its views.",
  inlineFile(path.resolve(options.scene)),
  "RENDERED SCENE above. Find the filled-in hero and compare only their visible wardrobe with the costume sheet. Allow normal pose, perspective, lighting, folds, and genuine occlusion. Reject if any visible garment type, dominant colour, pattern/graphic, bottom, footwear, or accessory conflicts with the sheet, if clothing from another reference was substituted, or if two outfits were blended. Do not judge face likeness.\n\nRespond in EXACTLY this format, nothing else:\nVERDICT: MATCH or NO_MATCH\nREASON: <one short sentence>",
]);
console.log(result.response.text().trim());
