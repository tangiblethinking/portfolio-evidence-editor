import crypto from "node:crypto";
import { ALLOWED_LOGINS, SESSION_HOURS, isConfigured } from "../../../../lib/config.ts";
import { loginFromCode } from "../../../../lib/github.ts";
import { OAUTH_COOKIE, SESSION_COOKIE, clearCookie, cookie, newSession, readCookie, unsign } from "../../../../lib/session.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const back = (origin: string, q: string, extra: string[] = []) => {
  const h = new Headers({ location: `${origin}/${q}`, "cache-control": "no-store" });
  h.append("set-cookie", clearCookie(OAUTH_COOKIE));
  for (const c of extra) h.append("set-cookie", c);
  return new Response(null, { status: 302, headers: h });
};
export async function GET(req: Request) {
  if (!isConfigured()) return Response.json({ error: "not_configured" }, { status: 503 });
  const url = new URL(req.url);
  const o = unsign<{ state: string; verifier: string }>(readCookie(req, OAUTH_COOKIE));
  const state = url.searchParams.get("state") || "", code = url.searchParams.get("code") || "";
  const a = Buffer.from(state), b = Buffer.from(o?.state || "");
  if (!o || !code || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return back(url.origin, "?auth=state");
  let login: string;
  try { login = await loginFromCode(url.origin, code, o.verifier); } catch { return back(url.origin, "?auth=failed"); }
  if (!(ALLOWED_LOGINS as readonly string[]).includes(login)) return back(url.origin, "?auth=forbidden");
  return back(url.origin, "", [cookie(SESSION_COOKIE, newSession(login).value, SESSION_HOURS * 3600)]);
}
