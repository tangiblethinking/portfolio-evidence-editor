// Server-side GitHub access with documented REST endpoints only, authenticated by a server-only fine-grained personal
// access token (EDITOR_GITHUB_TOKEN) scoped by its owner to tangiblethinking/portforag-test with Contents: read/write
// and Commit statuses: read. The token never leaves the server and is never returned or logged.
import { TARGET } from "./config.ts";
const API = "https://api.github.com";
const UA = "portfolio-evidence-editor";
export class GitHubError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }

async function gh(path: string, init: RequestInit & { token: string }): Promise<any> {
  const r = await fetch(`${API}${path}`, { ...init, headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": UA, authorization: `Bearer ${init.token}`, ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers || {}) }, cache: "no-store" });
  if (!r.ok) throw new GitHubError(r.status, `GitHub ${init.method || "GET"} ${path.split("?")[0]} -> ${r.status}`);
  return r.status === 204 ? null : r.json();
}

function getToken(): string {
  const t = process.env.EDITOR_GITHUB_TOKEN;
  if (!t) throw new GitHubError(503, "not configured");
  return t;
}

const repoPath = (p: string) => `/repos/${TARGET.owner}/${TARGET.repo}${p}`;
const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");

/** A file on TARGET.branch: blob sha + text. Uses the raw media type (works above the 1 MB JSON limit). */
export async function getFile(path: string, ref: string = TARGET.branch): Promise<{ sha: string; text: string }> {
  const token = getToken();
  const meta = await gh(repoPath(`/contents/${enc(path)}?ref=${encodeURIComponent(ref)}`), { token, headers: { accept: "application/vnd.github.object+json" } });
  const r = await fetch(`${API}${repoPath(`/git/blobs/${meta.sha}`)}`, { headers: { accept: "application/vnd.github.raw+json", "x-github-api-version": "2022-11-28", "user-agent": UA, authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!r.ok) throw new GitHubError(r.status, `GitHub blob ${path} -> ${r.status}`);
  return { sha: meta.sha, text: Buffer.from(await r.arrayBuffer()).toString("utf8") };
}
export async function getBlobBytes(sha: string): Promise<Buffer> {
  const token = getToken();
  const r = await fetch(`${API}${repoPath(`/git/blobs/${sha}`)}`, { headers: { accept: "application/vnd.github.raw+json", "x-github-api-version": "2022-11-28", "user-agent": UA, authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!r.ok) throw new GitHubError(r.status, `GitHub blob -> ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
/** Directory listing: name -> blob sha. */
export async function listDir(path: string): Promise<Record<string, string>> {
  const token = getToken();
  const items = await gh(repoPath(`/contents/${enc(path)}?ref=${TARGET.branch}`), { token });
  return Object.fromEntries((items as { name: string; sha: string; type: string }[]).filter((i) => i.type === "file").map((i) => [i.name, i.sha]));
}
/** Commit master.json directly to main only if its current blob sha is `baseSha` (GitHub returns 409 otherwise). */
export async function putMaster(text: string, baseSha: string, message: string): Promise<{ commit: string; blob: string }> {
  const token = getToken();
  const r = await gh(repoPath(`/contents/${enc(TARGET.masterPath)}`), { token, method: "PUT", body: JSON.stringify({ message, content: Buffer.from(text, "utf8").toString("base64"), sha: baseSha, branch: TARGET.branch }) });
  return { commit: r.commit.sha, blob: r.content.sha };
}
/** One commit on main with several file changes (Git Data API); fails if main moved from `headSha`. */
export async function commitFiles(headSha: string, files: { path: string; text?: string; blob?: string | null }[], message: string): Promise<string> {
  const token = getToken();
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
  const token = getToken();
  const r = await gh(repoPath(`/git/ref/heads/${TARGET.branch}`), { token });
  return r.object.sha;
}
/** Combined commit statuses (e.g. Vercel) for a commit. */
export async function commitStatuses(sha: string): Promise<{ context: string; state: string; description: string | null; target_url: string | null; updated_at: string }[]> {
  const token = getToken();
  const r = await gh(repoPath(`/commits/${encodeURIComponent(sha)}/status`), { token });
  return (r.statuses || []).map((s: any) => ({ context: s.context, state: s.state, description: s.description, target_url: s.target_url, updated_at: s.updated_at }));
}
/** Is `sha` on main (identical to or behind the head)? */
export async function onMain(sha: string): Promise<boolean> {
  const token = getToken();
  try {
    const r = await gh(repoPath(`/compare/${encodeURIComponent(sha)}...${TARGET.branch}`), { token });
    return r.status === "identical" || r.status === "ahead";
  } catch { return false; }
}
