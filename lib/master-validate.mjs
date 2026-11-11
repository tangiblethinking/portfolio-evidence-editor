// Structural validation of data/master.json (shared rules with the evidence editor's save validation).
export const MANUAL_FIELDS = ["title", "description", "skills", "keywords", "dates", "employer"];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function validateMaster(m) {
  const e = [];
  if (!m || m.format !== "portfolio-master" || !Array.isArray(m.records)) return ["not a portfolio-master document"];
  const ids = m.records.map((r) => r.id);
  if (new Set(ids).size !== ids.length) e.push("duplicate record ids");
  if (m.records.filter((r) => r.kind === "resume").length !== 1) e.push("exactly one resume record required");
  for (const r of m.records) {
    if (typeof r.id !== "string" || !/^[a-z0-9][a-z0-9._-]*$/.test(r.id)) e.push(`bad id ${r.id}`);
    if (typeof r.indexable !== "boolean") e.push(`${r.id}: indexable must be boolean`);
    if (typeof r.title !== "string" || !r.title) e.push(`${r.id}: title required`);
    if (r.description !== null && typeof r.description !== "string") e.push(`${r.id}: description must be string|null`);
    for (const k of ["skills", "keywords"]) if (!Array.isArray(r[k]) || r[k].some((x) => typeof x !== "string")) e.push(`${r.id}: ${k} must be string[]`);
    if (r.dates !== null && (typeof r.dates !== "object" || typeof r.dates.display !== "string")) e.push(`${r.id}: dates must be {display}|null`);
    if (r.employer !== null && (typeof r.employer !== "object" || typeof r.employer.status !== "string")) e.push(`${r.id}: employer must be {status,...}|null`);
    const manual = r.manual || {};
    for (const k of Object.keys(manual)) {
      if (!MANUAL_FIELDS.includes(k)) e.push(`${r.id}: manual.${k} is not an editable field`);
      else if (!eq(manual[k], r[k])) e.push(`${r.id}: manual.${k} not applied to the record`);
      else if (!r.source_values || !(k in r.source_values)) e.push(`${r.id}: source_values.${k} missing for manual correction`);
    }
  }
  return e;
}
