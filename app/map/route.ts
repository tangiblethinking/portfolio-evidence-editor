import { TARGET } from "../../lib/config.ts";
import { getFile } from "../../lib/github.ts";
import { injectOverlay } from "../../lib/map-page.ts";
import { authorize, json } from "../../lib/session.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** The original evidence map with the editor overlay. Signed-in only; signed-out browsers go to the login page. */
export async function GET(req: Request) {
  const a = authorize(req);
  if ("error" in a) {
    if (a.error.status === 401) return new Response(null, { status: 303, headers: { location: `${new URL(req.url).origin}/`, "cache-control": "no-store" } });
    return a.error;
  }
  try {
    const f = await getFile(TARGET.mapPath);
    return new Response(injectOverlay(f.text, a.session.csrf), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  } catch {
    return json(502, { error: "github" });
  }
}
