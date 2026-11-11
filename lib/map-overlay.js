/* Evidence editor overlay for the original evidence map (plain browser script, injected by lib/map-page.ts).
   Adds an Indexable toggle per canonical record (inventory rows, repository detail, and records the map has no row for,
   e.g. the resume) and one Save that posts { base_sha, changes: { id: { indexable } } } to /api/save with the CSRF token.
   It never changes the map's own facts, classifications or the Feature recommendation. */
(function () {
  "use strict";
  var CFG = JSON.parse(document.getElementById("editor-config").textContent);
  var DATA = JSON.parse(document.getElementById("evidence-data").textContent);
  var idByName = {}, mapIds = {};
  DATA.rows.forEach(function (r) { idByName[r.n] = r.id; mapIds[r.id] = true; });
  var S = { sha: null, base: {}, recs: {}, order: [], pending: {}, busy: false, loaded: false, msg: "Loading canonical master…", tone: "", reload: false };

  var css = document.createElement("style");
  css.textContent =
    "body{padding-bottom:120px}" +
    ".ed-bar{position:fixed;left:0;right:0;bottom:0;z-index:50;background:var(--bg);border-top:1px solid var(--border);box-shadow:0 -2px 10px rgba(0,0,0,.08);padding:10px 20px}" +
    ".ed-in{max-width:1440px;margin:0 auto;display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;font-size:14px}" +
    ".ed-in .ed-sum{font-weight:600}.ed-in .ed-msg{color:var(--muted);flex:1 1 260px}.ed-msg.bad{color:var(--bad)}.ed-msg.ok{color:var(--ok)}" +
    ".ed-btn{font:inherit;font-size:13.5px;border:1px solid var(--border);background:var(--bg);color:var(--text);padding:6px 12px;border-radius:6px;cursor:pointer;min-height:32px}" +
    ".ed-btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}.ed-btn:disabled{opacity:.5;cursor:default}" +
    ".ed-tog{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;font-size:13px;cursor:pointer}.ed-tog input{min-height:0;width:16px;height:16px}" +
    ".ed-tog.dirty{font-weight:600;color:var(--warn)}" +
    "td.ed-cell{min-width:0!important;width:1%}tr.ed-off>td:not(.ed-cell){opacity:.55}" +
    ".ed-detail{border:1px solid var(--border);border-left:4px solid var(--accent);border-radius:var(--radius);padding:10px 14px;margin:8px 0 4px;background:var(--subtle)}" +
    ".ed-detail .ed-note{color:var(--muted);font-size:13px;margin-top:4px}";
  document.head.appendChild(css);

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) { if (k === "text") e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); }
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function value(id) { return id in S.pending ? S.pending[id] : S.base[id]; }
  function dirtyCount() { return Object.keys(S.pending).length; }

  function toggle(id, text) {
    var cb = el("input", { type: "checkbox", "data-ed-id": id, "aria-label": "Indexable: " + ((S.recs[id] && S.recs[id].title) || id) });
    cb.addEventListener("change", function () { setIndexable(id, cb.checked); });
    return el("label", { class: "ed-tog", "data-ed-tog": id }, [cb, text || "Indexable"]);
  }
  function setIndexable(id, v) {
    if (!S.loaded || S.busy || !(id in S.base)) return;
    if (v === S.base[id]) delete S.pending[id]; else S.pending[id] = v;
    S.msg = ""; S.tone = "";
    refresh();
  }

  // ---- bar ----
  var sum = el("span", { class: "ed-sum" }), extra = el("span"), msg = el("span", { class: "ed-msg", role: "status", "aria-live": "polite" });
  var discard = el("button", { type: "button", class: "ed-btn", text: "Discard" });
  var save = el("button", { type: "button", class: "ed-btn primary", text: "Save to main" });
  var reloadBtn = el("button", { type: "button", class: "ed-btn", text: "Reload master" });
  var signout = el("button", { type: "button", class: "ed-btn", text: "Sign out" });
  var bar = el("div", { class: "ed-bar", role: "region", "aria-label": "Evidence editor" }, [el("div", { class: "ed-in" }, [el("b", { text: "Evidence editor" }), sum, extra, msg, reloadBtn, discard, save, signout])]);
  document.body.appendChild(bar);
  discard.addEventListener("click", function () { S.pending = {}; S.msg = "Changes discarded."; S.tone = ""; refresh(); });
  reloadBtn.addEventListener("click", function () { S.pending = {}; load(); });
  save.addEventListener("click", doSave);
  signout.addEventListener("click", function () {
    fetch("/api/auth/logout", { method: "POST", headers: { "x-csrf-token": CFG.csrf } }).finally(function () { location.href = "/"; });
  });
  window.addEventListener("beforeunload", function (e) { if (dirtyCount()) { e.preventDefault(); e.returnValue = ""; } });

  function refresh() {
    document.querySelectorAll("input[data-ed-id]").forEach(function (cb) {
      var id = cb.getAttribute("data-ed-id");
      var known = id in S.base;
      cb.disabled = !S.loaded || S.busy || !known;
      cb.checked = known ? !!value(id) : false;
      var lab = cb.parentNode; if (lab && lab.classList) lab.classList.toggle("dirty", id in S.pending);
      var tr = cb.closest("tr[data-repo-id]"); if (tr) tr.classList.toggle("ed-off", known && !value(id));
    });
    document.querySelectorAll(".ed-detail [data-ed-state]").forEach(function (n) { n.textContent = stateText(n.getAttribute("data-ed-state")); });
    var n = S.order.filter(function (id) { return value(id); }).length, d = dirtyCount();
    sum.textContent = S.loaded ? n + " of " + S.order.length + " records indexable" + (d ? " · " + d + " unsaved" : "") : "";
    msg.textContent = S.msg; msg.className = "ed-msg" + (S.tone ? " " + S.tone : "");
    save.disabled = !S.loaded || S.busy || !d; discard.disabled = S.busy || !d;
    reloadBtn.hidden = !S.reload; save.textContent = S.busy ? "Saving…" : d ? "Save " + d + " to main" : "Save to main";
  }
  function stateText(id) {
    var r = S.recs[id]; if (!r) return S.loaded ? "Not in the canonical master." : "";
    var man = Object.keys(r.manual || {});
    return "Canonical master record " + id + ": " + (r.indexable ? "indexable" : "not indexable") + (id in S.pending ? " (unsaved change)" : "") +
      (man.length ? " · manual corrections in master: " + man.join(", ") + " (this page shows the original evidence-map values)" : "");
  }

  // ---- decorate the map's own render output ----
  function decorateInventory() {
    var t = document.querySelector("#inventory table");
    if (!t || t.getAttribute("data-ed")) return;
    t.setAttribute("data-ed", "1");
    var htr = t.querySelector("thead tr");
    if (htr) htr.insertBefore(el("th", { scope: "col", text: "Indexable" }), htr.firstChild);
    t.querySelectorAll("tbody tr[data-repo-id]").forEach(function (tr) {
      tr.insertBefore(el("td", { class: "ed-cell" }, [toggle(tr.getAttribute("data-repo-id"), "")]), tr.firstChild);
    });
    refresh();
  }
  function decorateDetail() {
    var d = document.getElementById("detail"), sel = document.getElementById("detail-select");
    if (!d || d.querySelector(".ed-detail")) return;
    var id = sel && idByName[sel.value];
    if (!id) return;
    d.insertBefore(el("div", { class: "ed-detail" }, [toggle(id, "Indexable: this record can inform chat answers and appear as a card"), el("div", { class: "ed-note", "data-ed-state": id })]), d.firstChild);
    refresh();
  }
  function decorateExtra() {
    extra.textContent = "";
    S.order.filter(function (id) { return !mapIds[id]; }).forEach(function (id) {
      extra.appendChild(toggle(id, ((S.recs[id] && S.recs[id].title) || id) + " (not a map row)"));
    });
  }
  function observe(id, fn) {
    var n = document.getElementById(id);
    if (n) new MutationObserver(fn).observe(n, { childList: true });
    fn();
  }
  observe("inventory", decorateInventory);
  observe("detail", decorateDetail);

  // ---- data ----
  function load() {
    S.loaded = false; S.reload = false; S.msg = "Loading canonical master…"; S.tone = ""; refresh();
    return fetch("/api/master", { cache: "no-store" }).then(function (r) {
      if (r.status === 401) { location.href = "/"; return; }
      return r.json().then(function (j) {
        if (!r.ok || !j.master) throw new Error(j.error || r.status);
        S.sha = j.sha; S.base = {}; S.recs = {}; S.order = [];
        j.master.records.forEach(function (rec) { S.base[rec.id] = !!rec.indexable; S.recs[rec.id] = rec; S.order.push(rec.id); });
        S.pending = {}; S.loaded = true; S.msg = "Master " + j.path + " · blob " + String(j.sha).slice(0, 7); decorateExtra(); refresh();
      });
    }).catch(function () { S.msg = "Could not load the canonical master; toggles are disabled."; S.tone = "bad"; S.reload = true; refresh(); });
  }
  function doSave() {
    var ids = Object.keys(S.pending); if (!ids.length || S.busy) return;
    var changes = {}; ids.forEach(function (id) { changes[id] = { indexable: S.pending[id] }; });
    S.busy = true; S.msg = "Saving…"; S.tone = ""; refresh();
    fetch("/api/save", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": CFG.csrf }, body: JSON.stringify({ base_sha: S.sha, changes: changes }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { r: r, j: j }; }); })
      .then(function (x) {
        S.busy = false;
        if (x.r.ok) {
          ids.forEach(function (id) { S.base[id] = changes[id].indexable; S.recs[id].indexable = changes[id].indexable; });
          S.pending = {}; S.sha = x.j.sha;
          S.msg = "Saved " + ids.length + " change(s) to main as commit " + String(x.j.commit).slice(0, 7) + "."; S.tone = "ok";
        } else if (x.r.status === 401) { S.msg = "Session expired. Sign in again (your changes are not saved)."; S.tone = "bad"; }
        else if (x.r.status === 409) { S.msg = "The master changed since it was loaded" + ((x.j.changed_since_base || []).length ? " (" + x.j.changed_since_base.join(", ") + ")" : "") + ". Nothing was saved; reload and redo your changes."; S.tone = "bad"; S.reload = true; }
        else if (x.r.status === 422) { S.msg = "Not saved: " + (x.j.errors || []).join("; "); S.tone = "bad"; }
        else { S.msg = "Not saved (" + (x.j.error || x.r.status) + ")."; S.tone = "bad"; }
        refresh();
      }, function () { S.busy = false; S.msg = "Not saved: network error."; S.tone = "bad"; refresh(); });
  }
  load();
})();
