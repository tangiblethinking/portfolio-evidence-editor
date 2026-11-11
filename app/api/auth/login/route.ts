import crypto from "node:crypto";
import { isConfigured } from "../../../../lib/config.ts";
import { authorizeUrl } from "../../../../lib/github.ts";
import { OAUTH_COOKIE, cookie, sign } from "../../../../lib/session.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Starts GitHub App user sign-in with a signed, short-lived state + PKCE verifier cookie. */
export function GET(req: Request) {
  if (!isConfigured()) return Response.json({ error: "not_configured" }, { status: 503 });
  const origin = new URL(req.url).origin;
  const state = crypto.randomBytes(24).toString("base64url");
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return new Response(null, { status: 302, headers: { location: authorizeUrl(origin, state, challenge), "set-cookie": cookie(OAUTH_COOKIE, sign({ state, verifier, exp: Date.now() + 600_000 }), 600), "cache-control": "no-store" } });
}
