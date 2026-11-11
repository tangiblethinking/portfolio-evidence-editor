import { PORTFOLIO_URL } from "../../../lib/config.ts";
import { commitStatuses, onMain } from "../../../lib/github.ts";
import { authorize, json } from "../../../lib/session.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Three separate statuses for a saved commit:
 * - save: the commit is on main
 * - index: production /api/version reports this commit AND a build-time retrieval index built from this exact master
 * - deployment: GitHub commit statuses (e.g. Vercel) for the commit
 * Nothing is reported as done unless observed.
 */
export async function GET(req: Request) {
  const a = authorize(req);
  if ("error" in a) return a.error;
  const u = new URL(req.url);
  const commit = u.searchParams.get("commit") || "", sha256 = u.searchParams.get("master_sha256") || "";
  if (!/^[0-9a-f]{40}$/.test(commit) || !/^[0-9a-f]{64}$/.test(sha256)) return json(400, { error: "commit and master_sha256 required" });
  const [saved, statuses, version] = await Promise.all([
    onMain(commit).catch(() => false),
    commitStatuses(commit).catch(() => null),
    fetch(`${PORTFOLIO_URL}/api/version`, { cache: "no-store", signal: AbortSignal.timeout(8000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  let index: { state: string; detail: string };
  if (!version) index = { state: "unknown", detail: "production version endpoint unavailable" };
  else if (version.commit !== commit) index = { state: "pending", detail: `production is serving ${String(version.commit || "unknown").slice(0, 7)}` };
  else if (version.index?.built_at_build && version.index.master_sha256 === sha256 && version.master_sha256 === sha256) index = { state: "built", detail: `${version.index.chunks} chunks from ${version.index.enabled}/${version.index.records} enabled records (index ${version.index.chunks_version})` };
  else index = { state: "mismatch", detail: "production commit matches but its index was not built from the saved master" };
  const vercel = statuses?.filter((s) => /vercel/i.test(s.context)) ?? [];
  const deployment = statuses === null ? { state: "unknown", detail: "commit statuses unavailable" } : vercel.length ? { state: vercel[0].state, detail: vercel[0].description || "", url: vercel[0].target_url } : { state: "pending", detail: "no deployment status reported yet" };
  return json(200, { save: { state: saved ? "saved" : "not_on_main", commit }, index, deployment });
}
