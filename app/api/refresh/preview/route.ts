import { planRefresh, verifyCore } from "../../../../lib/refresh.ts";
import { authorize, json } from "../../../../lib/session.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
/** Preview a manual source refresh (nothing is written). body: { evidence_html }. */
export async function POST(req: Request) {
  const a = authorize(req, { mutate: true });
  if ("error" in a) return a.error;
  let body: any;
  try { body = await req.json(); } catch { return json(400, { error: "bad_json" }); }
  try {
    const stale = await verifyCore();
    if (stale) return json(409, { error: "core_mismatch", message: stale });
    const p = await planRefresh(body?.evidence_html);
    return json(200, { base_sha: p.base_sha, head: p.head, master_sha256: p.master_sha256, image_adds: p.image_adds.map((i) => i.path), image_deletes: p.image_deletes, summary: p.summary });
  } catch (e: any) {
    return json(422, { error: "refresh_failed", message: String(e?.message || e) });
  }
}
