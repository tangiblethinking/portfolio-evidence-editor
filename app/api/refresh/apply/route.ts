import { TARGET } from "../../../../lib/config.ts";
import { GitHubError, commitFiles } from "../../../../lib/github.ts";
import { planRefresh, verifyCore } from "../../../../lib/refresh.ts";
import { authorize, json } from "../../../../lib/session.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
/**
 * Apply a previewed refresh: one direct commit on main with the new evidence-map HTML, the regenerated master and the
 * public/evidence image changes. body: { evidence_html, base_sha, master_sha256 } from the preview; 409 if anything moved.
 */
export async function POST(req: Request) {
  const a = authorize(req, { mutate: true });
  if ("error" in a) return a.error;
  let body: any;
  try { body = await req.json(); } catch { return json(400, { error: "bad_json" }); }
  try {
    const stale = await verifyCore();
    if (stale) return json(409, { error: "core_mismatch", message: stale });
    const p = await planRefresh(body?.evidence_html);
    if (p.base_sha !== body?.base_sha || p.master_sha256 !== body?.master_sha256) return json(409, { error: "conflict", message: "master or sources changed since the preview; preview again" });
    const commit = await commitFiles(p.head, [
      { path: TARGET.mapPath, text: p.map_text },
      { path: TARGET.masterPath, text: p.master_text },
      ...p.image_adds.map((i) => ({ path: i.path, blob: i.blob })),
      ...p.image_deletes.map((d) => ({ path: d, blob: null })),
    ], `Evidence editor: source refresh (${p.summary.records} records, ${p.summary.carried_over.length} carried selections/corrections) by ${a.session.login}`);
    return json(200, { commit, master_sha256: p.master_sha256, summary: p.summary });
  } catch (e: any) {
    if (e instanceof GitHubError && (e.status === 409 || e.status === 422)) return json(409, { error: "conflict", message: "main moved during apply; preview again" });
    return json(502, { error: "refresh_failed", message: String(e?.message || e) });
  }
}
