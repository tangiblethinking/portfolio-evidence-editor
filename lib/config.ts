// Fixed target and fail-closed configuration. The repository, branch and file paths are constants: no request can
// point the editor at another repo or path.
export const TARGET = {
  owner: "tangiblethinking",
  repo: "portforag-test",
  branch: "main",
  masterPath: "data/master.json",
  mapPath: "data/source/evidence-map/index.html",
  imagesDir: "data/source/evidence-map/src/images",
  publicImagesDir: "public/evidence",
  corePath: "scripts/master-core.mjs",
  validatePath: "scripts/master-validate.mjs",
  resumePath: "public/resume.html",
  projectsPath: "projects.json",
  recentPath: "data/recent-work.json",
} as const;
/** Production portfolio, read only for its public /api/version (commit + index hashes). */
export const PORTFOLIO_URL = "https://portforag-test.vercel.app";
export const SESSION_HOURS = 8;

export const REQUIRED_ENV = ["EDITOR_GITHUB_TOKEN", "EDITOR_PASSWORD_HASH", "EDITOR_SESSION_SECRET"] as const;

/** EDITOR_PASSWORD_HASH format: scrypt$<N>$<r>$<p>$<salt base64url>$<key base64url> (see scripts/hash-password.mjs). */
export const PASSWORD_HASH_RE = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([A-Za-z0-9_-]{16,})\$([A-Za-z0-9_-]{43,})$/;

/** Names of missing/invalid settings (never values). Empty = configured. */
export function missingConfig(): string[] {
  const miss: string[] = REQUIRED_ENV.filter((k) => !process.env[k]);
  const t = process.env.EDITOR_GITHUB_TOKEN;
  if (t && !/^github_pat_[A-Za-z0-9_]{20,}$/.test(t)) miss.push("EDITOR_GITHUB_TOKEN (fine-grained token, github_pat_…)");
  const h = process.env.EDITOR_PASSWORD_HASH;
  const m = h ? h.match(PASSWORD_HASH_RE) : null;
  if (h && (!m || +m[1] < 16384 || (+m[1] & (+m[1] - 1)) !== 0)) miss.push("EDITOR_PASSWORD_HASH (scrypt$N$r$p$salt$key, N ≥ 16384)");
  const s = process.env.EDITOR_SESSION_SECRET;
  if (s && s.length < 32) miss.push("EDITOR_SESSION_SECRET (min 32 chars)");
  return miss;
}
export const isConfigured = () => missingConfig().length === 0;
