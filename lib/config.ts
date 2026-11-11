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
/** GitHub logins allowed to sign in. */
export const ALLOWED_LOGINS = ["tangiblethinking"] as const;
/** Production portfolio, read only for its public /api/version (commit + index hashes). */
export const PORTFOLIO_URL = "https://portforag-test.vercel.app";
export const SESSION_HOURS = 8;

export const REQUIRED_ENV = ["GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET", "GITHUB_APP_PRIVATE_KEY", "EDITOR_SESSION_SECRET"] as const;

/** Names of missing/invalid settings (never values). Empty = configured. */
export function missingConfig(): string[] {
  const miss: string[] = REQUIRED_ENV.filter((k) => !process.env[k]);
  const s = process.env.EDITOR_SESSION_SECRET;
  if (s && s.length < 32) miss.push("EDITOR_SESSION_SECRET (min 32 chars)");
  const pk = process.env.GITHUB_APP_PRIVATE_KEY;
  if (pk && !/BEGIN (RSA )?PRIVATE KEY/.test(pk.replace(/\\n/g, "\n"))) miss.push("GITHUB_APP_PRIVATE_KEY (PEM)");
  return miss;
}
export const isConfigured = () => missingConfig().length === 0;
