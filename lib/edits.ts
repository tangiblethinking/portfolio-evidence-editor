// Applying editor changes to the canonical master. Only `indexable` and allow-listed manual corrections can change.
import { MANUAL_FIELDS, validateMaster } from "./master-validate.mjs";

export type Change = { indexable?: boolean; manual?: Record<string, unknown> };
export type Changes = Record<string, Change>;
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const isStrArr = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === "string" && x.length <= 300) && v.length <= 200;

/** Type rules for manual values (null = revert to the source value). */
export function checkManualValue(field: string, v: unknown): string | null {
  if (v === null) return null;
  switch (field) {
    case "title": return typeof v === "string" && v.trim() && v.length <= 300 ? null : "title must be a non-empty string";
    case "description": return typeof v === "string" && v.length <= 5000 ? null : "description must be a string";
    case "skills": case "keywords": return isStrArr(v) ? null : `${field} must be a list of strings`;
    case "dates": return v && typeof v === "object" && typeof (v as any).display === "string" && (v as any).display.length <= 100 && Object.keys(v as object).every((k) => k === "display" || k === "source_field") ? null : "dates must be {display}";
    case "employer": {
      const e = v as any;
      return e && typeof e === "object" && typeof e.status === "string" && (e.employer === null || typeof e.employer === "string") && (e.position === null || typeof e.position === "string") ? null : "employer must be {status, employer, position}";
    }
  }
  return `${field} is not editable`;
}

/** Returns the new master or a list of errors. Never touches fields outside indexable/manual/source_values/effective manual fields. */
export function applyChanges(master: any, changes: Changes): { master: any; errors: string[]; changed: string[] } {
  const errors: string[] = [];
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return { master, errors: ["changes must be an object"], changed: [] };
  const next = structuredClone(master);
  const byId = new Map<string, any>(next.records.map((r: any) => [r.id, r]));
  const changed: string[] = [];
  for (const [id, ch] of Object.entries(changes)) {
    const r = byId.get(id);
    if (!r) { errors.push(`unknown record ${id}`); continue; }
    if (!ch || typeof ch !== "object") { errors.push(`${id}: bad change`); continue; }
    const extra = Object.keys(ch).filter((k) => k !== "indexable" && k !== "manual");
    if (extra.length) { errors.push(`${id}: cannot change ${extra.join(", ")}`); continue; }
    const before = JSON.stringify(r);
    if ("indexable" in ch) { if (typeof ch.indexable !== "boolean") errors.push(`${id}: indexable must be boolean`); else r.indexable = ch.indexable; }
    if (ch.manual !== undefined) {
      if (!ch.manual || typeof ch.manual !== "object") { errors.push(`${id}: manual must be an object`); continue; }
      for (const [k, v] of Object.entries(ch.manual)) {
        if (!(MANUAL_FIELDS as string[]).includes(k)) { errors.push(`${id}: ${k} is not editable`); continue; }
        const bad = checkManualValue(k, v);
        if (bad) { errors.push(`${id}: ${bad}`); continue; }
        r.manual ||= {}; r.source_values ||= {};
        if (v === null) {
          if (k in r.manual) { r[k] = r.source_values[k]; delete r.manual[k]; delete r.source_values[k]; }
        } else {
          if (!(k in r.manual)) r.source_values[k] = r[k];
          r[k] = v; r.manual[k] = v;
          if (eq(v, r.source_values[k])) { delete r.manual[k]; delete r.source_values[k]; }
        }
      }
    }
    if (JSON.stringify(r) !== before) changed.push(id);
  }
  if (!errors.length) {
    if (next.records.length !== master.records.length || !eq(next.records.map((r: any) => r.id), master.records.map((r: any) => r.id))) errors.push("record set changed");
    errors.push(...validateMaster(next));
  }
  // Same derived metadata the portfolio's build core writes, so a later `npm run build:master` is byte-identical.
  next.counts = { ...next.counts, indexable: next.records.filter((r: any) => r.indexable).length };
  next.refresh = { ...next.refresh, carried_over: next.records.filter((r: any) => r.indexable === false || Object.keys(r.manual || {}).length).map((r: any) => r.id).sort() };
  return { master: next, errors, changed };
}

/** Ids whose record differs between two master versions. */
export function changedIds(a: any, b: any): string[] {
  const m = new Map<string, string>(a.records.map((r: any) => [r.id, JSON.stringify(r)]));
  const ids = new Set<string>([...m.keys(), ...b.records.map((r: any) => r.id)]);
  return [...ids].filter((id) => m.get(id) !== JSON.stringify(b.records.find((r: any) => r.id === id))).sort();
}
export const serialize = (m: any) => JSON.stringify(m, null, 2) + "\n";
