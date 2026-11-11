// Deterministic editor tests with a mocked GitHub/production network. No real credentials. Run: npm test
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL " + m); } };
const PORTFOLIO = path.resolve("../portforag-test");
const masterText = fs.readFileSync(path.join(PORTFOLIO, "data/master.json"), "utf8");
const master = JSON.parse(masterText);
const blobSha = (t) => crypto.createHash("sha1").update(`blob ${Buffer.byteLength(t)}\0`).update(t).digest("hex");
const sha256 = (t) => crypto.createHash("sha256").update(t).digest("hex");
const ENV = ["GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET", "GITHUB_APP_PRIVATE_KEY", "EDITOR_SESSION_SECRET"];
for (const k of ENV) delete process.env[k];

// ---- mock network ----
const calls = [];
let repoFiles = {}; // path -> text
let blobs = {}; // sha -> Buffer
const gitSha = {}; // path -> sha for binary files
let headSha = "a".repeat(40);
let version = null, statuses = [], userLogin = "tangiblethinking";
const setFile = (p, t) => { repoFiles[p] = t; blobs[blobSha(t)] = Buffer.from(t); };
const R = (status, body) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url)); const m = (init.method || "GET").toUpperCase();
  calls.push({ m, url: u.toString(), body: init.body ? String(init.body) : null, auth: init.headers?.authorization });
  const P = u.pathname;
  if (u.host === "portforag-test.vercel.app" && P === "/api/version") return version ? R(200, version) : R(503, {});
  if (u.host === "github.com" && P === "/login/oauth/access_token") return R(200, { access_token: "user-token-x" });
  if (u.host !== "api.github.com") return R(404, {});
  if (P === "/user") return R(200, { login: userLogin });
  if (P === "/repos/tangiblethinking/portforag-test/installation") return R(200, { id: 42 });
  if (P === "/app/installations/42/access_tokens" && m === "POST") return R(201, { token: "inst-token", expires_at: new Date(Date.now() + 3600e3).toISOString() });
  const base = "/repos/tangiblethinking/portforag-test";
  if (!P.startsWith(base)) return R(404, {});
  const rest = P.slice(base.length);
  if (rest.startsWith("/contents/") && m === "GET") {
    const fp = decodeURIComponent(rest.slice(10));
    if (fp in repoFiles) return R(200, { sha: gitSha[fp] || blobSha(repoFiles[fp]), path: fp });
    const dir = Object.keys(repoFiles).filter((k) => k.startsWith(fp + "/") && !k.slice(fp.length + 1).includes("/"));
    if (dir.length) return R(200, dir.map((k) => ({ name: k.slice(fp.length + 1), sha: gitSha[k] || blobSha(repoFiles[k]), type: "file" })));
    return R(404, {});
  }
  if (rest.startsWith("/git/blobs/") && m === "GET") { const b = blobs[rest.slice(11)]; return b ? new Response(b, { status: 200 }) : R(404, {}); }
  if (rest.startsWith("/contents/") && m === "PUT") {
    const fp = decodeURIComponent(rest.slice(10)); const b = JSON.parse(init.body);
    if (blobSha(repoFiles[fp]) !== b.sha) return R(409, {});
    const t = Buffer.from(b.content, "base64").toString("utf8"); setFile(fp, t); headSha = "c".repeat(40);
    return R(200, { commit: { sha: headSha }, content: { sha: blobSha(t) } });
  }
  if (rest === "/git/ref/heads/main") return R(200, { object: { sha: headSha } });
  if (rest.startsWith("/commits/") && rest.endsWith("/status")) return R(200, { statuses });
  if (rest.startsWith("/compare/")) return R(200, { status: rest.includes(headSha) ? "identical" : "ahead" });
  return R(404, {});
};

const { authorize, newSession, SESSION_COOKIE, OAUTH_COOKIE, sign } = await import("../lib/session.ts");
const { applyChanges, serialize } = await import("../lib/edits.ts");
const { resetTokenCache } = await import("../lib/github.ts");
const masterRoute = await import("../app/api/master/route.ts");
const saveRoute = await import("../app/api/save/route.ts");
const statusRoute = await import("../app/api/status/route.ts");
const loginRoute = await import("../app/api/auth/login/route.ts");
const cbRoute = await import("../app/api/auth/callback/route.ts");
const previewRoute = await import("../app/api/refresh/preview/route.ts");
const applyRoute = await import("../app/api/refresh/apply/route.ts");
const O = "https://editor.example";
const req = (p, { method = "GET", cookie, origin, csrf, body } = {}) => new Request(O + p, { method, headers: { ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}), ...(csrf ? { "x-csrf-token": csrf } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });

// ---- fail closed when unconfigured ----
for (const [name, call] of [["master", () => masterRoute.GET(req("/api/master"))], ["save", () => saveRoute.POST(req("/api/save", { method: "POST", body: {} }))], ["status", () => statusRoute.GET(req("/api/status"))], ["login", () => loginRoute.GET(req("/api/auth/login"))], ["refresh", () => previewRoute.POST(req("/api/refresh/preview", { method: "POST", body: {} }))]])
  ok((await call()).status === 503, `unconfigured: ${name} -> 503`);
ok(!calls.length, "unconfigured: no network calls at all");

// ---- configure (test-only key + secret) ----
const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.GITHUB_APP_CLIENT_ID = "Iv1.test"; process.env.GITHUB_APP_CLIENT_SECRET = "test-secret";
process.env.GITHUB_APP_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).replace(/\n/g, "\\n");
process.env.EDITOR_SESSION_SECRET = crypto.randomBytes(32).toString("hex");
const sess = newSession("tangiblethinking");
const ck = `${SESSION_COOKIE}=${encodeURIComponent(sess.value)}`;
setFile("data/master.json", masterText);

for (const [name, call] of [["master", () => masterRoute.GET(req("/api/master"))], ["status", () => statusRoute.GET(req("/api/status?commit=" + "a".repeat(40) + "&master_sha256=" + "b".repeat(64)))], ["save", () => saveRoute.POST(req("/api/save", { method: "POST", origin: O, body: {} }))], ["refresh preview", () => previewRoute.POST(req("/api/refresh/preview", { method: "POST", origin: O, body: {} }))], ["refresh apply", () => applyRoute.POST(req("/api/refresh/apply", { method: "POST", origin: O, body: {} }))]])
  ok((await call()).status === 401, `no session: ${name} -> 401`);
const other = newSession("someone-else");
ok((await masterRoute.GET(req("/api/master", { cookie: `${SESSION_COOKIE}=${encodeURIComponent(other.value)}` }))).status === 401, "non-allow-listed login -> 401");
ok((await masterRoute.GET(req("/api/master", { cookie: ck.slice(0, -3) + "AAA" }))).status === 401, "tampered session -> 401");
const expired = sign({ login: "tangiblethinking", csrf: "x", exp: Date.now() - 1 });
ok((await masterRoute.GET(req("/api/master", { cookie: `${SESSION_COOKIE}=${encodeURIComponent(expired)}` }))).status === 401, "expired session -> 401");
ok((await saveRoute.POST(req("/api/save", { method: "POST", cookie: ck, csrf: sess.session.csrf, body: {} }))).status === 403, "save without Origin -> 403");
ok((await saveRoute.POST(req("/api/save", { method: "POST", cookie: ck, origin: "https://evil.example", csrf: sess.session.csrf, body: {} }))).status === 403, "save cross-origin -> 403");
ok((await saveRoute.POST(req("/api/save", { method: "POST", cookie: ck, origin: O, csrf: "wrong", body: {} }))).status === 403, "save bad CSRF -> 403");
ok(!calls.some((c) => c.m !== "GET"), "rejected requests made no GitHub writes");

// ---- read ----
const mr = await masterRoute.GET(req("/api/master", { cookie: ck }));
const mj = await mr.json();
ok(mr.status === 200 && mj.sha === blobSha(masterText) && mj.master.records.length === 87 && mj.path === "tangiblethinking/portforag-test@main:data/master.json", "read: single master from the fixed repo/path with blob sha");
ok(calls.some((c) => c.url.includes("/access_tokens") && JSON.parse(c.body).repositories[0] === "portforag-test" && JSON.parse(c.body).permissions.contents === "write" && JSON.parse(c.body).permissions.statuses === "read" && Object.keys(JSON.parse(c.body).permissions).length === 2), "installation token narrowed to the repo, contents:write + statuses:read only");

// ---- edits ----
{
  let r = applyChanges(master, { virtuallabs: { indexable: false } });
  ok(!r.errors.length && r.changed.join() === "virtuallabs" && r.master.records.find((x) => x.id === "virtuallabs").indexable === false, "toggle off");
  ok(applyChanges(master, { nope: { indexable: false } }).errors.length > 0, "unknown id rejected");
  ok(applyChanges(master, { virtuallabs: { deployment: {} } }).errors.length > 0, "non-editable key rejected");
  ok(applyChanges(master, { virtuallabs: { manual: { purpose: "x" } } }).errors.length > 0, "non-allow-listed manual field rejected");
  ok(applyChanges(master, { virtuallabs: { manual: { skills: "x" } } }).errors.length > 0, "manual type checked");
  r = applyChanges(master, { dls: { manual: { description: "Verified text." } } });
  const d = r.master.records.find((x) => x.id === "dls");
  ok(!r.errors.length && d.description === "Verified text." && d.manual.description === "Verified text." && d.source_values.description === master.records.find((x) => x.id === "dls").description, "manual correction applied with source value kept");
  const back = applyChanges(r.master, { dls: { manual: { description: null } } }).master.records.find((x) => x.id === "dls");
  ok(back.description === master.records.find((x) => x.id === "dls").description && !("description" in back.manual), "revert restores the source value");
}

// ---- save: conflict + exact file ----
{
  const oldText = masterText;
  const moved = serialize(applyChanges(master, { dls: { indexable: false } }).master);
  setFile("data/master.json", moved);
  blobs[blobSha(oldText)] = Buffer.from(oldText);
  const r = await saveRoute.POST(req("/api/save", { method: "POST", cookie: ck, origin: O, csrf: sess.session.csrf, body: { base_sha: blobSha(oldText), changes: { virtuallabs: { indexable: false } } } }));
  const j = await r.json();
  ok(r.status === 409 && j.changed_since_base.join() === "dls" && j.current_sha === blobSha(moved), "stale base -> 409 with the records changed meanwhile");
  ok(repoFiles["data/master.json"] === moved, "conflict wrote nothing");
  setFile("data/master.json", oldText);
  const s = await saveRoute.POST(req("/api/save", { method: "POST", cookie: ck, origin: O, csrf: sess.session.csrf, body: { base_sha: blobSha(oldText), changes: { virtuallabs: { indexable: false } } } }));
  const sj = await s.json();
  const put = calls.filter((c) => c.m === "PUT");
  ok(s.status === 200 && put.length === 1 && new URL(put[0].url).pathname === "/repos/tangiblethinking/portforag-test/contents/data/master.json", "save PUTs exactly tangiblethinking/portforag-test data/master.json");
  const pb = JSON.parse(put[0].body);
  ok(pb.branch === "main" && pb.sha === blobSha(oldText), "direct commit to main with base sha");
  const saved = repoFiles["data/master.json"];
  ok(saved === serialize(applyChanges(master, { virtuallabs: { indexable: false } }).master) && sj.master_sha256 === sha256(saved) && sj.changed.join() === "virtuallabs", "saved bytes = canonical serialization; only the toggled record changed");
  ok(JSON.parse(saved).records.find((x) => x.id === "virtuallabs").indexable === false && JSON.parse(saved).records.length === 87, "disabled record stays stored (87 records)");
  const inv = await saveRoute.POST(req("/api/save", { method: "POST", cookie: ck, origin: O, csrf: sess.session.csrf, body: { base_sha: blobSha(saved), changes: { virtuallabs: { manual: { repository: "x" } } } } }));
  ok(inv.status === 422, "invalid change -> 422, nothing written");
  ok((await saveRoute.POST(req("/api/save", { method: "POST", cookie: ck, origin: O, csrf: sess.session.csrf, body: { base_sha: "main", changes: {} } }))).status === 400, "base_sha must be a blob sha");
  setFile("data/master.json", masterText);
}

// ---- status ----
{
  const commit = "c".repeat(40), ms = "d".repeat(64);
  headSha = commit;
  version = { commit: "e".repeat(40), master_sha256: ms, index: { master_sha256: ms, built_at_build: true, chunks: 94, enabled: 86, records: 87, chunks_version: "v" } };
  statuses = [];
  let j = await (await statusRoute.GET(req(`/api/status?commit=${commit}&master_sha256=${ms}`, { cookie: ck }))).json();
  ok(j.save.state === "saved" && j.index.state === "pending" && j.deployment.state === "pending", "status: saved; index pending while production serves another commit; no deployment status yet");
  version = { ...version, commit };
  statuses = [{ context: "Vercel", state: "success", description: "Deployment has completed", target_url: "https://vercel.com/x", updated_at: "" }];
  j = await (await statusRoute.GET(req(`/api/status?commit=${commit}&master_sha256=${ms}`, { cookie: ck }))).json();
  ok(j.index.state === "built" && j.deployment.state === "success", "status: index built only when production commit + build-time index hash match the saved master");
  version = { ...version, index: { ...version.index, master_sha256: "f".repeat(64) } };
  j = await (await statusRoute.GET(req(`/api/status?commit=${commit}&master_sha256=${ms}`, { cookie: ck }))).json();
  ok(j.index.state === "mismatch", "status: index hash mismatch is not reported as built");
  version = null;
  j = await (await statusRoute.GET(req(`/api/status?commit=${commit}&master_sha256=${ms}`, { cookie: ck }))).json();
  ok(j.index.state === "unknown", "status: unreachable version endpoint -> unknown");
}

// ---- sign-in ----
{
  const lr = await loginRoute.GET(req("/api/auth/login"));
  const loc = new URL(lr.headers.get("location"));
  ok(lr.status === 302 && loc.host === "github.com" && loc.searchParams.get("redirect_uri") === `${O}/api/auth/callback` && loc.searchParams.get("code_challenge_method") === "S256" && loc.searchParams.get("state") && !loc.searchParams.get("scope"), "login: GitHub App user authorization with state + PKCE, no scopes");
  const oc = lr.headers.get("set-cookie").split(";")[0];
  const state = loc.searchParams.get("state");
  let r = await cbRoute.GET(req(`/api/auth/callback?code=x&state=wrong`, { cookie: oc }));
  ok(r.headers.get("location").endsWith("?auth=state") && !/pee_session=[^;]/.test(r.headers.get("set-cookie") || ""), "callback: bad state rejected");
  r = await cbRoute.GET(req(`/api/auth/callback?code=x&state=${state}`));
  ok(r.headers.get("location").endsWith("?auth=state"), "callback: missing state cookie rejected");
  userLogin = "intruder";
  r = await cbRoute.GET(req(`/api/auth/callback?code=x&state=${state}`, { cookie: oc }));
  ok(r.headers.get("location").endsWith("?auth=forbidden") && !/pee_session=[^;]/.test(r.headers.get("set-cookie") || ""), "callback: non-allow-listed GitHub login gets no session");
  userLogin = "tangiblethinking";
  r = await cbRoute.GET(req(`/api/auth/callback?code=x&state=${state}`, { cookie: oc }));
  const sc = r.headers.getSetCookie().find((c) => c.startsWith(SESSION_COOKIE + "="));
  ok(sc && /HttpOnly/.test(sc) && /Secure/.test(sc) && /SameSite=Lax/.test(sc) && !/user-token-x/.test(sc), "callback: allow-listed login gets HttpOnly Secure session; user token not stored");
  const ex = calls.find((c) => c.url.startsWith("https://github.com/login/oauth/access_token"));
  ok(JSON.parse(ex.body).code_verifier, "code exchange sends the PKCE verifier");
}

// ---- refresh: same core as the portfolio, byte-identical, preserves selections ----
{
  for (const f of ["scripts/master-core.mjs", "scripts/master-validate.mjs", "public/resume.html", "projects.json", "data/recent-work.json", "data/source/evidence-map/index.html"]) setFile(f, fs.readFileSync(path.join(PORTFOLIO, f), "utf8"));
  for (const f of fs.readdirSync(path.join(PORTFOLIO, "data/source/evidence-map/src/images"))) { const b = fs.readFileSync(path.join(PORTFOLIO, "data/source/evidence-map/src/images", f)); const s = crypto.createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex"); repoFiles[`data/source/evidence-map/src/images/${f}`] = ""; gitSha[`data/source/evidence-map/src/images/${f}`] = s; blobs[s] = b; }
  // listDir uses blobSha of the stored string; make image entries return the true git sha
  for (const f of fs.readdirSync(path.join(PORTFOLIO, "public/evidence"))) { const b = fs.readFileSync(path.join(PORTFOLIO, "public/evidence", f)); const s = crypto.createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex"); repoFiles[`public/evidence/${f}`] = ""; gitSha[`public/evidence/${f}`] = s; }
  const withToggle = serialize(applyChanges(master, { virtuallabs: { indexable: false, manual: { description: "Verified." } } }).master);
  setFile("data/master.json", withToggle);
  const mapHtml = repoFiles["data/source/evidence-map/index.html"];
  const pr = await previewRoute.POST(req("/api/refresh/preview", { method: "POST", cookie: ck, origin: O, csrf: sess.session.csrf, body: { evidence_html: mapHtml } }));
  const pj = await pr.json();
  if (pr.status !== 200) console.log(pj);
  ok(pj.image_adds?.length === 0 && pj.image_deletes?.length === 0, "refresh: no image changes for the same sources");
  ok(pr.status === 200 && pj.summary.records === 87 && pj.summary.changed.length === 0 && pj.summary.carried_over.includes("virtuallabs"), "refresh preview: same sources -> no record changes, selection + correction carried");
  ok(pj.master_sha256 === sha256(withToggle), "refresh output is byte-identical to the current master (same core as npm run build:master)");
  ok(pj.summary.missing_image_files.length === 0, "refresh: all captured image files found in the repo");
  const writesBefore = calls.filter((c) => c.m !== "GET" && c.url.includes("/repos/")).length;
  ok(writesBefore === 0 || calls.filter((c) => c.m === "PUT").length === 1, "preview writes nothing");
  fs.writeFileSync("/tmp/editor-core-backup", fs.readFileSync("lib/master-core.mjs"));
  setFile("scripts/master-core.mjs", repoFiles["scripts/master-core.mjs"] + "\n// changed");
  const cm = await previewRoute.POST(req("/api/refresh/preview", { method: "POST", cookie: ck, origin: O, csrf: sess.session.csrf, body: { evidence_html: mapHtml } }));
  ok(cm.status === 409 && (await cm.json()).error === "core_mismatch", "refresh refuses when the portfolio core differs from the editor's copy");
  ok((await applyRoute.POST(req("/api/refresh/apply", { method: "POST", cookie: ck, origin: O, csrf: "bad", body: {} }))).status === 403, "refresh apply needs CSRF");
}

// ---- vendored core identical to the portfolio's ----
ok(fs.readFileSync("lib/master-core.mjs", "utf8") === fs.readFileSync(path.join(PORTFOLIO, "scripts/master-core.mjs"), "utf8"), "lib/master-core.mjs == portfolio scripts/master-core.mjs");
ok(fs.readFileSync("lib/master-validate.mjs", "utf8") === fs.readFileSync(path.join(PORTFOLIO, "scripts/master-validate.mjs"), "utf8"), "lib/master-validate.mjs == portfolio scripts/master-validate.mjs");
// ---- no secrets/credentials in client code ----
const client = fs.readFileSync("components/Editor.tsx", "utf8");
ok(!/process\.env|PRIVATE_KEY|CLIENT_SECRET|SESSION_SECRET/.test(client), "client component reads no secrets");
ok(!fs.readdirSync("app/api", { recursive: true }).some((f) => /demo|public/.test(String(f))), "no demo/public write endpoints");

console.log(`editor tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
