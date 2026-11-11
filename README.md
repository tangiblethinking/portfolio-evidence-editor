# portfolio-evidence-editor

Private, protected editor for the ONE canonical portfolio master: `tangiblethinking/portforag-test` → `main:data/master.json`.
The editor keeps no copy: every read fetches that file server-side, every save commits it directly to `main` (no PR).

## What it does
- Evidence-map style table (adapted from the evidence-map HTML styles) with search and filters (family, recommendation,
  employer status, indexable, conflicts/corrections), per-record **Indexable** toggle and verified corrections for
  `title`, `description`, `skills`, `keywords`, `dates`, `employer` (stored in `record.manual`, source value kept in
  `record.source_values`, revertible). “Feature” is shown as a label only.
- **Save**: `POST /api/save {base_sha, changes}` → re-reads the file, 409 if its blob sha moved (lists records changed
  meanwhile), validates (same validator as the portfolio: ids, count, fields, editable keys only), commits with the
  Contents API using `sha=base_sha`. Repo, branch and path are constants (`lib/config.ts`); requests cannot choose them.
- **Statuses, separately**: save (commit on main) · index (production `GET /api/version` reports this commit AND a
  build-time retrieval index whose master hash equals the saved file) · deployment (GitHub commit statuses, Vercel).
  Nothing is shown as done unless observed.
- **Source refresh (manual only)**: upload a newer evidence-map `index.html` → preview → apply. Uses `lib/master-core.mjs`,
  which must be byte-identical to the portfolio's `scripts/master-core.mjs` (checked against GitHub before each
  preview/apply), so output equals `npm run build:master`. Toggles and corrections carry over. Image files must already
  be in the repo; missing ones are flagged, never fetched. One commit: source HTML + master + `public/evidence` changes.
  No schedule or automatic source fetching exists; define permitted sources/frequency before adding any.

## Security model
- Sign-in: single owner password. Only its scrypt hash is configured (`EDITOR_PASSWORD_HASH`); login is a same-origin
  form POST, constant-time verified, throttled (5 failures per IP per 15 min, per instance).
- Session: stateless HMAC-signed cookie (`__Host-`, HttpOnly, Secure, SameSite=Lax, 8 h) carrying a CSRF token.
- Every API route calls `authorize()`: 503 if unconfigured, 401 without a valid session; state-changing routes also
  require same-origin `Origin` and `x-csrf-token`.
- Repo access: server-only fine-grained personal access token (`EDITOR_GITHUB_TOKEN`, must start `github_pat_`), used only
  for `tangiblethinking/portforag-test` (paths fixed in code). Never sent to the browser or logged. Fails closed (login page
  shows "not configured") until all settings are valid. Headers: CSP (frame-ancestors none), X-Frame-Options DENY,
  noindex, no-referrer, HSTS.

## Setup (owner)
1. Create a fine-grained PAT: Resource owner `tangiblethinking` → Only select repositories → `portforag-test` →
   Repository permissions **Contents: Read and write**, **Commit statuses: Read-only** (Metadata read is automatic).
2. Make the password hash locally: `node scripts/hash-password.mjs` (input hidden; prints `scrypt$32768$8$1$<salt>$<key>`).
3. In the Vercel project (Production) add as **Sensitive**: `EDITOR_GITHUB_TOKEN`, `EDITOR_PASSWORD_HASH`,
   `EDITOR_SESSION_SECRET` (random, ≥ 32 chars).
4. Redeploy; sign in at `https://portfolio-evidence-editor.vercel.app/`.

Public paths: `/` (login or "not configured" page) and `POST /api/auth/login`. Everything else requires a session.

## Dev
`npm test` (mocked network: auth, CSRF, conflicts, exact file, refresh identity) · `npm run typecheck` · `npm run build`.
Node 24 (tests import `.ts` with type stripping).
