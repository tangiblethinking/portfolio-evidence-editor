import { SESSION_HOURS, isConfigured } from "../../../../lib/config.ts";
import { SESSION_COOKIE, cookie, newSession, sameOrigin, verifyPassword } from "../../../../lib/session.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-instance throttle: 5 failed attempts per IP per 15 minutes (serverless instances do not share this state).
const fails = new Map<string, number[]>();
const WINDOW = 15 * 60_000, MAX = 5;
const ipOf = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
const redirect = (req: Request, q: string, setCookie?: string) => new Response(null, { status: 303, headers: { location: `${new URL(req.url).origin}/${q}`, "cache-control": "no-store", ...(setCookie ? { "set-cookie": setCookie } : {}) } });

/** Password sign-in (form POST, same-origin only). Success: signed session cookie; failure: generic error. */
export async function POST(req: Request) {
  if (!isConfigured()) return Response.json({ error: "not_configured" }, { status: 503 });
  if (!sameOrigin(req)) return Response.json({ error: "bad_origin" }, { status: 403 });
  const ip = ipOf(req), now = Date.now();
  const recent = (fails.get(ip) || []).filter((t) => now - t < WINDOW);
  if (recent.length >= MAX) return redirect(req, "?auth=locked");
  let password = "";
  try { const f = await req.formData(); const v = f.get("password"); password = typeof v === "string" ? v : ""; } catch { /* not a form */ }
  if (!verifyPassword(password)) {
    recent.push(now); fails.set(ip, recent);
    await new Promise((r) => setTimeout(r, 400));
    return redirect(req, "?auth=failed");
  }
  fails.delete(ip);
  return redirect(req, "", cookie(SESSION_COOKIE, newSession().value, SESSION_HOURS * 3600));
}
export function GET() { return Response.json({ error: "method_not_allowed" }, { status: 405 }); }
