// Server-side GitHub access with documented REST endpoints only.
// Repository access: GitHub App installation token, narrowed per request to TARGET.repo with
// contents:write + statuses:read. User sign-in: GitHub App user authorization (OAuth web flow with state + PKCE),
// used only to read the signed-in login; the user token is discarded.
import crypto from "node:crypto";
import { TARGET } from "./config.ts";

const API = "https://api.github.com";
const UA = "portfolio-evidence-editor";
export class GitHubError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }

function appJwt(): string {
  const now = Math.floor(Date.now() / 1000);
  const head = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 540, iss: process.env.GITHUB_APP_CLIENT_ID })).toString("base64url");
  const pem = (process.env.GITHUB_APP_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  const sig = crypto.createSign("RSA-SHA256").update(`${head}.${body}`).sign(pem).toString("base64url");
  return `${head}.${body}.${sig}`;
}
async function gh(path: string, init: RequestInit & { token: string }): Promise<any> {
  const r = await fetch(`${API}${path}`, { ...init, headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": UA, authorization: `Bearer ${init.token}`, ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers || {}) }, cache: "no-store" });
  if (!r.ok) throw new GitHubError(r.status, `GitHub ${init.method || "GET"} ${path.split("?")[0]} -> ${r.status}`);
  return r.status === 204 ? null : r.json();
}

let cached: { token: string; exp: number } | null = null;
export async function installationToken(): Promise<string> {
  if (cached && cached.exp - Date.now() > 120_000) return cached.token;
  const jwt = appJwt();
  const inst = await gh(`/repos/${TARGET.owner}/${TARGET.repo}/installation`, { token: jwt });
  const t = await gh(`/app/installations/${inst.id}/access_tokens`, { token: jwt, method: "POST", body: JSON.stringify({ repositories: [TARGET.repo], permissions: { contents: "write", statuses: "read" } }) });
  cached = { token: t.token, exp: Date.parse(t.expires_at) };
  return t.token;
}
export function resetTokenCache() { cached = null; }

const repoPath = (p: string) => `/repos/${TARGET.owner}/${TARGET.repo}${p}`;
const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");

/** A file on TARGET.branch: blob sha + text. Uses the raw media type (works above the 1 MB JSON limit). */
export async function getFile(path: string, ref: string = TARGET.branch): Promise<{ sha: string; text: string }> {
  const token = await installationToken();
  const meta = await gh(repoPath(`/contents/${enc(path)}?ref=${encodeURIComponent(ref)}`), { token, headers: { accept: "application/vnd.github.object+json" } });
  const r = await fetch(`${API}${repoPath(`/git/blobs/${meta.sha}`)}`, { headers: { accept: "application/vnd.github.raw+json", "x-github-api-version": "2022-11-28", "user-agent": UA, authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!r.ok) throw new GitHubError(r.status, `GitHub blob ${path} -> ${r.status}`);
  return { sha: meta.sha, text: Buffer.from(await r.arrayBuffer()).toString("utf8") };
}
export async function getBlobBytes(sha: string): Promise<Buffer> {
  const token = await installationToken();
  const r = await fetch(`${API}${repoPath(`/git/blobs/${sha}`)}`, { headers: { accept: "application/vnd.github.raw+json", "x-github-api-version": "2022-11-28", "user-agent": UA, authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!r.ok) throw new GitHubError(r.status, `GitHub blob -> ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
/** Directory listing: name -> blob sha. */
export async function listDir(path: string): Promise<Record<string, string>> {
  const token = await installationToken();
  const items = await gh(repoPath(`/contents/${enc(path)}?ref=${TARGET.branch}`), { token });
  return Object.fromEntries((items as { name: string; sha: string; type: string }[]).filter((i) => i.type === "file").map((i) => [i.name, i.sha]));
}
/** Commit master.json directly to main only if its current blob sha is `baseSha` (GitHub returns 409 otherwise). */
export async function putMaster(text: string, baseSha: string, message: string): Promise<{ commit: string; blob: string }> {
  const token = await installationToken();
  const r = await gh(repoPath(`/contents/${enc(TARGET.masterPath)}`), { token, method: "PUT", body: JSON.stringify({ message, content: Buffer.from(text, "utf8").toString("base64"), sha: baseSha, branch: TARGET.branch }) });
  return { commit: r.commit.sha, blob: r.content.sha };
}
/** One commit on main with several file changes (Git Data API); fails if main moved from `headSha`. */
export async function commitFiles(headSha: string, files: { path: string; text?: string; blob?: string | null }[], message: string): Promise<string> {
  const token = await installationToken();
  const head = await gh(repoPath(`/git/commits/${headSha}`), { token });
  const tree = [];
  for (const f of files) {
    if (f.text !== undefined) {
      const b = await gh(repoPath(`/git/blobs`), { token, method: "POST", body: JSON.stringify({ content: Buffer.from(f.text, "utf8").toString("base64"), encoding: "base64" }) });
      tree.push({ path: f.path, mode: "100644", type: "blob", sha: b.sha });
    } else tree.push({ path: f.path, mode: "100644", type: "blob", sha: f.blob ?? null });
  }
  const t = await gh(repoPath(`/git/trees`), { token, method: "POST", body: JSON.stringify({ base_tree: head.tree.sha, tree }) });
  const c = await gh(repoPath(`/git/commits`), { token, method: "POST", body: JSON.stringify({ message, tree: t.sha, parents: [headSha] }) });
  await gh(repoPath(`/git/refs/heads/${TARGET.branch}`), { token, method: "PATCH", body: JSON.stringify({ sha: c.sha, force: false }) });
  return c.sha;
}
export async function headCommit(): Promise<string> {
  const token = await installationToken();
  const r = await gh(repoPath(`/git/ref/heads/${TARGET.branch}`), { token });
  return r.object.sha;
}
/** Combined commit statuses (e.g. Vercel) for a commit. */
export async function commitStatuses(sha: string): Promise<{ context: string; state: string; description: string | null; target_url: string | null; updated_at: string }[]> {
  const token = await installationToken();
  const r = await gh(repoPath(`/commits/${encodeURIComponent(sha)}/status`), { token });
  return (r.statuses || []).map((s: any) => ({ context: s.context, state: s.state, description: s.description, target_url: s.target_url, updated_at: s.updated_at }));
}
/** Is `sha` on main (identical to or behind the head)? */
export async function onMain(sha: string): Promise<boolean> {
  const token = await installationToken();
  try {
    const r = await gh(repoPath(`/compare/${encodeURIComponent(sha)}...${TARGET.branch}`), { token });
    return r.status === "identical" || r.status === "ahead";
  } catch { return false; }
}

// ---- user sign-in (GitHub App user authorization) ----
export function authorizeUrl(origin: string, state: string, challenge: string): string {
  const u = new URL("https://github.com/login/oauth/authorize");
  u.searchParams.set("client_id", process.env.GITHUB_APP_CLIENT_ID || "");
  u.searchParams.set("redirect_uri", `${origin}/api/auth/callback`);
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("allow_signup", "false");
  return u.toString();
}
export async function loginFromCode(origin: string, code: string, verifier: string): Promise<string> {
  const r = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST", headers: { accept: "application/json", "content-type": "application/json", "user-agent": UA },
    body: JSON.stringify({ client_id: process.env.GITHUB_APP_CLIENT_ID, client_secret: process.env.GITHUB_APP_CLIENT_SECRET, code, redirect_uri: `${origin}/api/auth/callback`, code_verifier: verifier }),
    cache: "no-store",
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new GitHubError(401, "code exchange failed");
  const user = await gh("/user", { token: j.access_token });
  return String(user.login);
}
