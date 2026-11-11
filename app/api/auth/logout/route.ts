import { SESSION_COOKIE, authorize, clearCookie } from "../../../../lib/session.ts";
export const runtime = "nodejs";
export function POST(req: Request) {
  const a = authorize(req, { mutate: true });
  if ("error" in a) return a.error;
  return Response.json({ ok: true }, { headers: { "set-cookie": clearCookie(SESSION_COOKIE), "cache-control": "no-store" } });
}
