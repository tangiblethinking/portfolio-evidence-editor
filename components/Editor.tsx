"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { applyChanges, type Changes } from "../lib/edits.ts";

const PORTFOLIO = "https://portforag-test.vercel.app";
type Rec = any;
type Loaded = { sha: string; head: string; path: string; master: { records: Rec[]; sources: any; unaccounted: any[] } };
type SaveInfo = { commit: string; master_sha256: string; changed: string[] };
type Status = { save: { state: string; commit: string }; index: { state: string; detail: string }; deployment: { state: string; detail: string; url?: string } };
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

export default function Editor({ csrf }: { csrf: string }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState<Changes>({});
  const [q, setQ] = useState("");
  const [fam, setFam] = useState("");
  const [rec, setRec] = useState("");
  const [emp, setEmp] = useState("");
  const [onOff, setOnOff] = useState("");
  const [flag, setFlag] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<string[] | null>(null);
  const [saved, setSaved] = useState<SaveInfo | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [refresh, setRefresh] = useState<{ html: string; preview?: any; result?: any } | null>(null);

  const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify(body) });
  const load = useCallback(async () => {
    setErr(null);
    const r = await fetch("/api/master", { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) { setErr(j.message || j.error); return; }
    setData(j);
  }, []);
  useEffect(() => { load(); }, [load]);

  const view = useMemo(() => (data ? applyChanges(data.master, pending) : null), [data, pending]);
  const records: Rec[] = view?.master.records ?? [];
  const families = useMemo(() => [...new Set(records.map((r) => r.family).filter(Boolean))].sort(), [records]);
  const shown = records.filter((r) => {
    if (fam && r.family !== fam) return false;
    if (rec && (r.recommendation || "") !== rec) return false;
    if (emp && (r.employer?.status || "") !== emp) return false;
    if (onOff && String(r.indexable) !== onOff) return false;
    if (flag === "conflict" && !r.flags.some((f: string) => f.startsWith("conflict"))) return false;
    if (flag === "manual" && !Object.keys(r.manual || {}).length) return false;
    if (q) { const t = `${r.id} ${r.title} ${r.description || ""} ${(r.keywords || []).join(" ")} ${(r.skills || []).join(" ")} ${r.employer?.employer || ""}`.toLowerCase(); if (!q.toLowerCase().split(/\s+/).every((w) => t.includes(w))) return false; }
    return true;
  });

  const change = (id: string, c: { indexable?: boolean; manual?: Record<string, unknown> }) =>
    setPending((p) => ({ ...p, [id]: { ...p[id], ...(c.indexable !== undefined ? { indexable: c.indexable } : {}), ...(c.manual ? { manual: { ...(p[id]?.manual || {}), ...c.manual } } : {}) } }));
  const dirty = Object.keys(pending).length;

  async function save() {
    if (!data || !view || view.errors.length) return;
    setBusy(true); setErr(null); setConflict(null);
    const r = await post("/api/save", { base_sha: data.sha, changes: pending });
    const j = await r.json();
    setBusy(false);
    if (r.status === 409) { setConflict(j.changed_since_base || []); return; }
    if (!r.ok) { setErr(j.errors?.join("; ") || j.message || j.error); return; }
    setSaved(j); setStatus(null); setPending({}); await load();
  }
  useEffect(() => {
    if (!saved) return;
    let stop = false;
    const tick = async () => {
      const r = await fetch(`/api/status?commit=${saved.commit}&master_sha256=${saved.master_sha256}`, { cache: "no-store" });
      if (r.ok && !stop) { const s: Status = await r.json(); setStatus(s); if (s.index.state === "built" && ["success", "failure", "error"].includes(s.deployment.state)) return; }
      if (!stop) setTimeout(tick, 10000);
    };
    tick();
    return () => { stop = true; };
  }, [saved]);

  async function previewRefresh() {
    if (!refresh?.html) return;
    setBusy(true);
    const r = await post("/api/refresh/preview", { evidence_html: refresh.html });
    const j = await r.json(); setBusy(false);
    setRefresh({ ...refresh, preview: r.ok ? j : { error: j.message || j.error } });
  }
  async function applyRefresh() {
    const p = refresh?.preview;
    if (!p || p.error) return;
    setBusy(true);
    const r = await post("/api/refresh/apply", { evidence_html: refresh!.html, base_sha: p.base_sha, master_sha256: p.master_sha256 });
    const j = await r.json(); setBusy(false);
    setRefresh({ ...refresh!, result: r.ok ? j : { error: j.message || j.error } });
    if (r.ok) { setSaved({ commit: j.commit, master_sha256: j.master_sha256, changed: [] }); await load(); }
  }
  async function logout() { await post("/api/auth/logout", {}); location.href = "/"; }

  if (!data) return <main><h1>Portfolio evidence editor</h1>{err ? <p className="err">{err}</p> : <p className="muted">Loading the master from GitHub…</p>}</main>;
  return (
    <main>
      <div className="bar">
        <div><h1>Portfolio evidence editor</h1><p className="summary">One master: <code>{data.path}</code> · blob {data.sha.slice(0, 7)} · {records.length} records · {records.filter((r) => r.indexable).length} indexable</p></div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}><button className="btn" onClick={logout}>Sign out</button></div>
      </div>

      <div className="status">
        <div className="metric"><div className="l">Save</div><div className="v">{saved ? (status?.save.state === "saved" ? `Saved ${saved.commit.slice(0, 7)}` : `Committed ${saved.commit.slice(0, 7)}`) : dirty ? `${dirty} unsaved` : "No changes"}</div><div className="d">Direct commit to main</div></div>
        <div className="metric"><div className="l">Index</div><div className="v">{saved ? status?.index.state ?? "checking" : "—"}</div><div className="d">{status?.index.detail ?? "Built from the saved master during the portfolio build"}</div></div>
        <div className="metric"><div className="l">Deployment</div><div className="v">{saved ? status?.deployment.state ?? "checking" : "—"}</div><div className="d">{status?.deployment.url ? <a href={status.deployment.url} target="_blank" rel="noreferrer">{status.deployment.detail || "details"}</a> : status?.deployment.detail ?? "Vercel commit status"}</div></div>
      </div>

      {err && <p className="err">{err}</p>}
      {conflict && <div className="err">The master changed on GitHub since you loaded it{conflict.length ? ` (records: ${conflict.join(", ")})` : ""}. Your edits are kept. <button className="btn" onClick={async () => { setConflict(null); await load(); }}>Reload latest and keep my edits</button></div>}
      {view && view.errors.length > 0 && <p className="err">{view.errors.join("; ")}</p>}

      <div className="bar">
        <div className="controls" style={{ flex: 1 }}>
          <label className="ctl">Search<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="title, skill, keyword, employer…" /></label>
          <label className="ctl">Family<select value={fam} onChange={(e) => setFam(e.target.value)}><option value="">All</option>{families.map((f) => <option key={f}>{f}</option>)}</select></label>
          <label className="ctl">Recommendation<select value={rec} onChange={(e) => setRec(e.target.value)}><option value="">All</option>{[...new Set(records.map((r) => r.recommendation).filter(Boolean))].sort().map((x) => <option key={x as string}>{x as string}</option>)}</select></label>
          <label className="ctl">Employer status<select value={emp} onChange={(e) => setEmp(e.target.value)}><option value="">All</option>{[...new Set(records.map((r) => r.employer?.status).filter(Boolean))].sort().map((x) => <option key={x as string}>{x as string}</option>)}</select></label>
          <label className="ctl">Indexable<select value={onOff} onChange={(e) => setOnOff(e.target.value)}><option value="">All</option><option value="true">On</option><option value="false">Off</option></select></label>
          <label className="ctl">Flags<select value={flag} onChange={(e) => setFlag(e.target.value)}><option value="">All</option><option value="conflict">Conflicts</option><option value="manual">Has corrections</option></select></label>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" disabled={!dirty || busy} onClick={() => setPending({})}>Discard</button>
          <button className="btn primary" disabled={!dirty || busy || !!view?.errors.length} onClick={save}>{busy ? "Working…" : `Save ${dirty || ""} to main`}</button>
        </div>
      </div>
      <p className="caption">Showing {shown.length} of {records.length}. “Feature” is a recommendation label only; the Indexable toggle decides whether a record can inform answers and appear as a card.</p>

      <div className="tablewrap"><table>
        <thead><tr><th>Indexable</th><th>Record</th><th>Image</th><th>Employer</th><th>Recommendation</th><th>Flags</th></tr></thead>
        <tbody>
          {shown.map((r) => (
            <RecordRow key={r.id} r={r} dirty={!!pending[r.id]} open={open === r.id} onOpen={() => setOpen(open === r.id ? null : r.id)} onChange={(c) => change(r.id, c)} />
          ))}
        </tbody>
      </table></div>

      <section>
        <h2>Source refresh (manual)</h2>
        <p className="caption">Upload a newer evidence-map <code>index.html</code>. The preview merges it with the same build core as <code>npm run build:master</code>, keeping every indexable selection and verified correction. Images must already exist in the portfolio repo’s <code>{"data/source/evidence-map/src/images"}</code>; missing ones are flagged, never fetched. No automatic or scheduled refresh is enabled.</p>
        <input type="file" accept=".html,text/html" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setRefresh({ html: await f.text() }); }} />{" "}
        <button className="btn" disabled={!refresh?.html || busy} onClick={previewRefresh}>Preview</button>{" "}
        <button className="btn primary" disabled={!refresh?.preview || refresh.preview.error || busy || dirty > 0} onClick={applyRefresh}>Apply to main</button>
        {dirty > 0 && refresh?.preview && <p className="muted">Save or discard record edits before applying a refresh.</p>}
        {refresh?.preview?.error && <p className="err">{refresh.preview.error}</p>}
        {refresh?.preview && !refresh.preview.error && (
          <dl className="props">
            <dt>Records</dt><dd>{refresh.preview.summary.records}</dd>
            <dt>Added</dt><dd>{refresh.preview.summary.added.join(", ") || "none"}</dd>
            <dt>Removed</dt><dd>{refresh.preview.summary.removed.join(", ") || "none"}</dd>
            <dt>Changed</dt><dd>{refresh.preview.summary.changed.length} records</dd>
            <dt>Carried over</dt><dd>{refresh.preview.summary.carried_over.join(", ") || "none"}</dd>
            <dt>Missing image files</dt><dd>{refresh.preview.summary.missing_image_files.join(", ") || "none"}</dd>
            <dt>Image changes</dt><dd>+{refresh.preview.image_adds.length} / −{refresh.preview.image_deletes.length}</dd>
          </dl>
        )}
        {refresh?.result && (refresh.result.error ? <p className="err">{refresh.result.error}</p> : <p className="okmsg">Refresh committed {refresh.result.commit.slice(0, 7)}.</p>)}
      </section>
    </main>
  );
}

function RecordRow({ r, dirty, open, onOpen, onChange }: { r: Rec; dirty: boolean; open: boolean; onOpen: () => void; onChange: (c: { indexable?: boolean; manual?: Record<string, unknown> }) => void }) {
  const manual = r.manual || {};
  const src = (k: string) => (k in manual ? r.source_values?.[k] : undefined);
  return (
    <>
      <tr className={`${r.indexable ? "" : "off"} ${dirty ? "dirty" : ""}`}>
        <td><input type="checkbox" aria-label={`Indexable: ${r.title}`} checked={r.indexable} onChange={(e) => onChange({ indexable: e.target.checked })} /></td>
        <td data-field="purpose"><button className="btn" style={{ border: 0, padding: 0, minHeight: 0, textAlign: "left" }} onClick={onOpen} aria-expanded={open}><b>{r.title}</b></button><div className="muted"><code>{r.id}</code> · {r.kind === "resume" ? "supplied resume" : r.family}</div><div>{r.description}</div></td>
        <td>{r.image ? <div className="tcell"><img src={PORTFOLIO + r.image.src} alt={r.image.alt} loading="lazy" /></div> : <span className="tstate">No capture</span>}</td>
        <td data-field="employer"><span className="emp"><b>{r.employer?.employer || "—"}</b><span className="st">{r.employer?.status}{r.employer?.position ? ` · ${r.employer.position}` : ""}</span></span></td>
        <td>{r.recommendation ? <span className={`pill ${r.recommendation === "Feature" ? "accent" : ""}`}>{r.recommendation}</span> : "—"}</td>
        <td>{r.flags.length ? <span className={`pill ${r.flags.some((f: string) => f.startsWith("conflict")) ? "warning" : ""}`} title={r.flags.join("\n")}>{r.flags.length}</span> : "—"}{Object.keys(manual).length ? <span className="pill success" title="Has verified corrections">✓ {Object.keys(manual).length}</span> : null}</td>
      </tr>
      {open && (
        <tr><td colSpan={6}>
          <div className="edit">
            <Field label="Title" value={r.title} source={src("title")} onSave={(v) => onChange({ manual: { title: v } })} onRevert={"title" in manual ? () => onChange({ manual: { title: null } }) : undefined} />
            <Field label="Description" multiline value={r.description || ""} source={src("description")} onSave={(v) => onChange({ manual: { description: v } })} onRevert={"description" in manual ? () => onChange({ manual: { description: null } }) : undefined} />
            <Field label="Skills (one per line)" multiline value={(r.skills || []).join("\n")} source={src("skills")?.join(", ")} onSave={(v) => onChange({ manual: { skills: lines(v) } })} onRevert={"skills" in manual ? () => onChange({ manual: { skills: null } }) : undefined} />
            <Field label="Keywords (one per line)" multiline value={(r.keywords || []).join("\n")} source={src("keywords")?.join(", ")} onSave={(v) => onChange({ manual: { keywords: lines(v) } })} onRevert={"keywords" in manual ? () => onChange({ manual: { keywords: null } }) : undefined} />
            <Field label="Dates (display)" value={r.dates?.display || ""} source={src("dates")?.display} onSave={(v) => onChange({ manual: { dates: v.trim() ? { display: v.trim(), source_field: "manual" } : null } })} onRevert={"dates" in manual ? () => onChange({ manual: { dates: null } }) : undefined} />
            <Field label="Employer (named employer, blank = not confirmed)" value={r.employer?.employer || ""} source={src("employer")?.employer ?? undefined} onSave={(v) => onChange({ manual: { employer: { ...(r.employer || {}), status: v.trim() ? "named" : r.employer?.status === "named" ? "unconfirmed" : r.employer?.status || "unconfirmed", employer: v.trim() || null, position: r.employer?.position ?? null } } })} onRevert={"employer" in manual ? () => onChange({ manual: { employer: null } }) : undefined} />
            <dl className="props">
              <dt>Live URL</dt><dd>{r.deployment?.live_url ? <a href={r.deployment.live_url} target="_blank" rel="noreferrer">{r.deployment.live_url}</a> : "—"}</dd>
              <dt>Repository</dt><dd>{r.repository ? <a href={r.repository.url} target="_blank" rel="noreferrer">{r.repository.owner}/{r.repository.name}</a> : "—"}</dd>
              <dt>Functional keywords</dt><dd><span className="chips">{(r.functional_keywords || []).map((k: any) => <span key={k.term} className="chip">{k.term}</span>)}</span></dd>
              <dt>Experience evidence</dt><dd>{r.experience_evidence || "—"}</dd>
              <dt>Flags</dt><dd>{r.flags.join("; ") || "—"}</dd>
              <dt>Source</dt><dd>{(r.sources || []).map((s: any) => `${s.type} ${s.path}${s.map_checked ? ` (checked ${s.map_checked})` : ""}`).join("; ")}</dd>
            </dl>
          </div>
        </td></tr>
      )}
    </>
  );
}

function Field({ label, value, source, multiline, onSave, onRevert }: { label: string; value: string; source?: string; multiline?: boolean; onSave: (v: string) => void; onRevert?: () => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <label>{label}
      {multiline ? <textarea value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v)} /> : <input value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v)} />}
      {source !== undefined && <span className="src">Source value: {source || "—"} {onRevert && <button type="button" className="btn" onClick={onRevert}>Revert to source</button>}</span>}
    </label>
  );
}
