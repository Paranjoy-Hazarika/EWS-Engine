// ---------- tiers ----------
export const TIER = {
  Low:    { color: "#1e8e5a", bar: "#2fa36b", tint: "#e3f5ec", glyph: "●", text: "Low risk" },
  Medium: { color: "#a85f00", bar: "#f2a516", tint: "#fff1d6", glyph: "◆", text: "Medium risk" },
  High:   { color: "#c62828", bar: "#d93025", tint: "#fde4e4", glyph: "▲", text: "High risk" },
};
export const TIER_ORDER = { High: 0, Medium: 1, Low: 2 };

// ---------- the seven vitals ----------
export const VITALS = [
  { key: "respiration_rate", param: "Respiration Rate", label: "Resp. rate", unit: "/min" },
  { key: "spo2", param: "SpO2", label: "SpO₂", unit: "%" },
  { key: "supplemental_o2", param: "Supplemental O2", label: "On oxygen", unit: "", kind: "bool" },
  { key: "systolic_bp", param: "Systolic BP", label: "Systolic BP", unit: "mmHg" },
  { key: "pulse", param: "Pulse", label: "Pulse", unit: "bpm" },
  { key: "consciousness", param: "Consciousness", label: "Consciousness", unit: "", kind: "cat" },
  { key: "temperature", param: "Temperature", label: "Temperature", unit: "°C" },
];

function lookupValue(v, raw) {
  if (v.kind === "bool") return raw ? 1 : 0;
  if (v.kind === "cat") return raw === "Alert" ? 0 : 1;
  return Number(raw);
}

// Same band lookup the backend does, used only to colour what the nurse sees.
// The server is still the single source of truth for the saved score.
export function pointsFor(rules, v, raw) {
  if (raw === "" || raw === null || raw === undefined) return null;
  const val = lookupValue(v, raw);
  if (Number.isNaN(val)) return null;
  const hit = rules.find(
    (r) => r.parameter_name === v.param && val >= Number(r.range_min) && val <= Number(r.range_max)
  );
  return hit ? Number(hit.score) : null;
}

export function scoreReading(rules, reading) {
  const rows = VITALS.map((v) => ({ ...v, raw: reading[v.key], points: pointsFor(rules, v, reading[v.key]) }));
  const complete = rows.every((r) => r.points !== null);
  const total = rows.reduce((s, r) => s + (r.points || 0), 0);
  const max = Math.max(0, ...rows.map((r) => r.points || 0));
  let tier = total >= 7 ? "High" : total >= 5 ? "Medium" : "Low";
  if (max >= 3 && tier === "Low") tier = "Medium";
  return { rows, complete, total, tier };
}

export function showValue(v, raw) {
  if (raw === "" || raw === null || raw === undefined) return "–";
  if (v.kind === "bool") return raw ? "Yes" : "No";
  if (v.key === "temperature") return Number(raw).toFixed(1);
  return String(raw);
}

// normal range = the band(s) that score 0 for this parameter (sentinels become null)
export function normalRange(rules, param) {
  const zero = rules.filter((r) => r.parameter_name === param && Number(r.score) === 0);
  if (!zero.length) return null;
  const lo = Math.min(...zero.map((r) => Number(r.range_min)));
  const hi = Math.max(...zero.map((r) => Number(r.range_max)));
  return { min: lo <= -900 ? null : lo, max: hi >= 900 ? null : hi };
}

// ---------- alerts ----------
export const ALERT_INFO = {
  threshold_breach: {
    title: "Critical score",
    text: "The latest score is in the High tier. Call the doctor now.",
    color: "#c62828", tint: "#fde4e4",
  },
  worsening_trend: {
    title: "Worsening trend",
    text: "The score has risen across the last three readings. Review the patient.",
    color: "#a85f00", tint: "#fff1d6",
  },
};

// ---------- time ----------
// Flask sends naive DB datetimes as "... GMT"; show them in UTC so the clock
// time on screen is the clock time the nurse recorded.
export function fmtDateTime(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d)) return String(v);
  return d.toLocaleString("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}
export function fmtDate(v) {
  if (!v) return "–";
  const d = new Date(v);
  if (isNaN(d)) return String(v);
  return d.toLocaleDateString("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" });
}
export function fmtClock(v) {
  const d = new Date(v);
  if (isNaN(d)) return "";
  return d.toLocaleTimeString("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hour12: false });
}
export function nowForDb() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
export function normalizeDbTime(v) {
  if (!v) return nowForDb();
  let s = v.replace("T", " ");
  if (s.length === 16) s += ":00";
  return s;
}
