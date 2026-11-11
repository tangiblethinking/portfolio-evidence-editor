import { TARGET } from "../../../lib/config.ts";
import { getFile, headCommit } from "../../../lib/github.ts";
import { authorize, json } from "../../../lib/session.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** The single canonical master from the portfolio repo (main), with its blob sha for conflict detection. */
export async function GET(req: Request) {
  const a = authorize(req);
  if ("error" in a) return a.error;
  try {
    const [file, head] = await Promise.all([getFile(TARGET.masterPath), headCommit()]);
    return json(200, { sha: file.sha, head, path: `${TARGET.owner}/${TARGET.repo}@${TARGET.branch}:${TARGET.masterPath}`, master: JSON.parse(file.text) });
  } catch (e: any) {
    return json(502, { error: "github", message: String(e?.message || e) });
  }
}
