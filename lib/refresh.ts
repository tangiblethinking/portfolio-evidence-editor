// Manual source refresh: merge a new evidence-map HTML into the canonical master with the SAME build core the
// portfolio uses (lib/master-core.mjs, verified byte-identical to the repo's scripts/master-core.mjs before use).
// Toggles and manual corrections carry over. No scheduled or automatic source fetching exists.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { TARGET } from "./config.ts";
import { getBlobBytes, getFile, headCommit, listDir } from "./github.ts";
import { changedIds, serialize } from "./edits.ts";
// @ts-ignore vendored JS core
import { buildMaster } from "./master-core.mjs";

const sha256 = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");
export function webpSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 30 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") return null;
  const t = buf.toString("ascii", 12, 16);
  if (t === "VP8X") return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  if (t === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  if (t === "VP8L") { const b = buf.readUInt32LE(21); return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
  return null;
}
export function capturedFiles(mapHtml: string): string[] {
  const m = mapHtml.match(/<script type="application\/json" id="evidence-data">([\s\S]*?)<\/script>/);
  if (!m) throw new Error("evidence-data block not found");
  const ev = JSON.parse(m[1].replace(/<\\\//g, "</"));
  if (!Array.isArray(ev.rows) || !ev.thumbnails?.entries) throw new Error("evidence map has no rows/thumbnails");
  return [...new Set(Object.values(ev.thumbnails.entries as Record<string, any>).filter((t) => t.status === "captured" && t.final).map((t) => String(t.final).split("/").pop() as string))];
}

/** The repo's core/validator must match the vendored copies, so the editor and `npm run build:master` agree byte-for-byte. */
export async function verifyCore(): Promise<string | null> {
  for (const [repoPath, local] of [[TARGET.corePath, "master-core.mjs"], [TARGET.validatePath, "master-validate.mjs"]] as const) {
    const remote = await getFile(repoPath);
    const mine = fs.readFileSync(path.join(process.cwd(), "lib", local), "utf8");
    if (sha256(remote.text) !== sha256(mine)) return `${repoPath} differs from the editor's vendored lib/${local}; update the editor before refreshing`;
  }
  return null;
}

export type RefreshPlan = {
  base_sha: string; head: string; master_text: string; master_sha256: string; map_text: string;
  image_adds: { path: string; blob: string }[]; image_deletes: string[];
  summary: { records: number; added: string[]; removed: string[]; changed: string[]; carried_over: string[]; missing_image_files: string[]; unaccounted: number; conflicts: number };
};

export async function planRefresh(mapHtml: string): Promise<RefreshPlan> {
  if (typeof mapHtml !== "string" || mapHtml.length < 1000 || mapHtml.length > 5_000_000) throw new Error("evidence map HTML required");
  const files = capturedFiles(mapHtml);
  const [head, cur, resume, projects, recent, srcImgs, pubImgs] = await Promise.all([
    headCommit(), getFile(TARGET.masterPath), getFile(TARGET.resumePath), getFile(TARGET.projectsPath), getFile(TARGET.recentPath), listDir(TARGET.imagesDir), listDir(TARGET.publicImagesDir),
  ]);
  const prev = JSON.parse(cur.text);
  const known = new Map<string, { sha256: string; width: number; height: number }>();
  for (const r of prev.records) for (const im of r.images || []) known.set(im.file, { sha256: im.sha256, width: im.width, height: im.height });
  const info = new Map<string, { sha256: string; width: number; height: number } | null>();
  for (const f of files) {
    if (!srcImgs[f]) { info.set(f, null); continue; }
    if (known.has(f)) { info.set(f, known.get(f)!); continue; }
    const buf = await getBlobBytes(srcImgs[f]);
    const dim = webpSize(buf);
    info.set(f, dim ? { sha256: sha256(buf), ...dim } : null);
  }
  const rt = JSON.parse(projects.text);
  const { doc, usedImages } = buildMaster({ mapHtml, resumeHtml: resume.text, runtimeProjects: rt.projects || rt, recentItems: JSON.parse(recent.text).items, prev, imageInfo: (f: string) => info.get(f) ?? null });
  const text = serialize(doc);
  const prevIds = new Set<string>(prev.records.map((r: any) => r.id)), nextIds = new Set<string>(doc.records.map((r: any) => r.id));
  return {
    base_sha: cur.sha, head, master_text: text, master_sha256: sha256(text), map_text: mapHtml,
    image_adds: (usedImages as string[]).filter((f) => !pubImgs[f] || pubImgs[f] !== srcImgs[f]).map((f) => ({ path: `${TARGET.publicImagesDir}/${f}`, blob: srcImgs[f] })),
    image_deletes: Object.keys(pubImgs).filter((f) => !(usedImages as string[]).includes(f)).map((f) => `${TARGET.publicImagesDir}/${f}`),
    summary: {
      records: doc.records.length,
      added: [...nextIds].filter((i) => !prevIds.has(i)),
      removed: [...prevIds].filter((i) => !nextIds.has(i)),
      changed: changedIds(prev, doc).filter((i) => prevIds.has(i) && nextIds.has(i)),
      carried_over: doc.refresh.carried_over,
      missing_image_files: files.filter((f) => !info.get(f)),
      unaccounted: doc.unaccounted.length,
      conflicts: doc.records.filter((r: any) => r.flags.some((f: string) => f.startsWith("conflict:"))).length,
    },
  };
}
