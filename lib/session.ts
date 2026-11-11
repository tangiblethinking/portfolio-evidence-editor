// Stateless signed sessions (HMAC-SHA256, HttpOnly, Secure, SameSite=Lax) + CSRF + same-origin checks.
import crypto from "node:crypto";
import { ALLOWED_LOGINS, SESSION_HOURS, isConfigured } from "./config.ts";

export const SESSION_COOKIE = "__Host-pee_session";
export const OAUTH_COOKIE = "__Host-pee_oauth";
export type Session = { login: string; csrf: string; exp: number };

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const key = () => {
  const s = process.env.EDITOR_SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("not configured");
  return s;
};
export function sign(payload: object): string {
  const body = b64u(JSON.stringify(payload));
  const mac = crypto.createHmac("sha256", key()).update(body).digest("base64url");
  return `${body}.${mac}`;
}
export function unsign<T>(value: string | undefined): T | null {
  if (!value) return null;
  const [body, mac] = value.split(".");
  if (!body || !mac) return null;
  const want = crypto.createHmac("sha256", key()).update(body).digest();
  const got = Buffer.from(mac, "base64url");
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return typeof p.exp === "number" && p.exp > Date.now() ? (p as T) : null;
  } catch { return null; }
}
export function readCookie(req: Request, name: string): string | undefined {
  const h = req.headers.get("cookie") || "";
  for (const part of h.split(/;\s*/)) { const i = part.indexOf("="); if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1)); }
  return undefined;
}
export const cookie = (name: string, value: string, maxAgeSec: number) =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
export const clearCookie = (name: string) => `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

export function newSession(login: string): { value: string; session: Session } {
  const session = { login, csrf: crypto.randomBytes(32).toString("base64url"), exp: Date.now() + SESSION_HOURS * 3600_000 };
  return { value: sign(session), session };
}
export function getSession(req: Request): Session | null {
  if (!isConfigured()) return null;
  const s = unsign<Session>(readCookie(req, SESSION_COOKIE));
  return s && (ALLOWED_LOGINS as readonly string[]).includes(s.login) ? s : null;
}

const json = (status: number, body: object) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
/**
 * Gate for every API route. Fails closed: 503 when unconfigured, 401 without a valid allow-listed session, and for
 * state-changing requests 403 unless the Origin is this site and x-csrf-token matches the session.
 */
export function authorize(req: Request, opts: { mutate?: boolean } = {}): { session: Session } | { error: Response } {
  if (!isConfigured()) return { error: json(503, { error: "not_configured" }) };
  const session = getSession(req);
  if (!session) return { error: json(401, { error: "unauthorized" }) };
  if (opts.mutate) {
    const origin = req.headers.get("origin");
    if (!origin || origin !== new URL(req.url).origin) return { error: json(403, { error: "bad_origin" }) };
    const t = req.headers.get("x-csrf-token") || "";
    const a = Buffer.from(t), b = Buffer.from(session.csrf);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { error: json(403, { error: "bad_csrf" }) };
  }
  return { session };
}
export { json };
