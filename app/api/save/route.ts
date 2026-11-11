import crypto from "node:crypto";
import { TARGET } from "../../../lib/config.ts";
import { GitHubError, getBlobBytes, getFile, putMaster } from "../../../lib/github.ts";
import { applyChanges, changedIds, serialize, type Changes } from "../../../lib/edits.ts";
import { authorize, json } from "../../../lib/session.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Save edits to data/master.json on main. body: { base_sha, changes, message? }.
 * 409 if the file changed since base_sha (lists the records changed meanwhile). Direct commit, no PR.
 */
export async function POST(req: Request) {
  const a = authorize(req, { mutate: true });
  if ("error" in a) return a.error;
  let body: any;
  try { body = await req.json(); } catch { return json(400, { error: "bad_json" }); }
  const base = typeof body?.base_sha === "string" && /^[0-9a-f]{40}$/.test(body.base_sha) ? body.base_sha : null;
  if (!base) return json(400, { error: "base_sha required" });
  try {
    const cur = await getFile(TARGET.masterPath);
    const current = JSON.parse(cur.text);
    if (cur.sha !== base) {
      let changed: string[] = [];
      try { changed = changedIds(JSON.parse((await getBlobBytes(base)).toString("utf8")), current); } catch { /* base blob unavailable */ }
      return json(409, { error: "conflict", current_sha: cur.sha, changed_since_base: changed });
    }
    const { master, errors, changed } = applyChanges(current, body.changes as Changes);
    if (errors.length) return json(422, { error: "invalid", errors });
    if (!changed.length) return json(400, { error: "no_changes" });
    const text = serialize(master);
    const msg = `Evidence editor: ${changed.length} record(s) (${changed.slice(0, 6).join(", ")}${changed.length > 6 ? ", …" : ""}) by ${a.session.login}`;
    const r = await putMaster(text, base, msg);
    return json(200, { commit: r.commit, sha: r.blob, master_sha256: crypto.createHash("sha256").update(text).digest("hex"), changed });
  } catch (e: any) {
    if (e instanceof GitHubError && e.status === 409) return json(409, { error: "conflict", changed_since_base: [] });
    return json(502, { error: "github", message: String(e?.message || e) });
  }
}
