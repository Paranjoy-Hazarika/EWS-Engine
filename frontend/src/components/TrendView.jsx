import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea, ReferenceLine,
} from "recharts";
import { api } from "../api.js";
import { useRules } from "../hooks.js";
import { useLive } from "../live.jsx";
import { TIER, VITALS, fmtDateTime, fmtClock, normalRange, scoreReading, showValue } from "../utils.js";
import TierBadge from "./TierBadge.jsx";

/* ------------------------------------------------------------------ */
/*  Chart helpers: range filter, bucketing (downsampling), smoothing   */
/* ------------------------------------------------------------------ */
const HOUR = 36e5;
const MIN = 6e4;
const PRESETS = [
  { k: "15m", label: "15 min", ms: 15 * MIN },
  { k: "1h", label: "1 h", ms: HOUR },
  { k: "6h", label: "6 h", ms: 6 * HOUR },
  { k: "12h", label: "12 h", ms: 12 * HOUR },
  { k: "24h", label: "24 h", ms: 24 * HOUR },
  { k: "3d", label: "3 days", ms: 72 * HOUR },
  { k: "7d", label: "7 days", ms: 168 * HOUR },
  { k: "30d", label: "30 days", ms: 720 * HOUR },
];
const toInput = (ms) => new Date(ms).toISOString().slice(0, 16);          // for <input type="datetime-local"> (UTC, like the rest of the app)
const fromInput = (v) => (v ? Date.parse(v + ":00Z") : NaN);
const SMOOTH = [
  { k: 0, label: "Off" },
  { k: 5, label: "Light" },
  { k: 11, label: "Strong" },
];
const MAX_POINTS = 60;      // never draw more than this many points per chart
const DOT_LIMIT = 40;       // above this, individual dots are hidden

const toMs = (iso) => new Date(iso).getTime();
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const stamp = (ms, sec = true) =>
  new Date(ms).toLocaleString("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", ...(sec ? { second: "2-digit" } : {}), hour12: false });
const clockSec = (ms) =>
  new Date(ms).toLocaleTimeString("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

/* Group a series (already in reading order, each point has x = reading index) into <= maxPts groups by INDEX. */
function bucketize(points, maxPts, reduce) {
  if (points.length <= maxPts) return points.map((p) => reduce([p]));
  const size = points.length / maxPts;
  const groups = [];
  points.forEach((p, i) => {
    const g = Math.min(maxPts - 1, Math.floor(i / size));
    (groups[g] = groups[g] || []).push(p);
  });
  return groups.filter(Boolean).map(reduce);
}

/* Centered moving average over the raw readings, ignoring gaps. */
function smooth(points, key, win) {
  if (win <= 1) return points.map((p) => ({ ...p, s: p[key] }));
  const half = Math.floor(win / 2);
  return points.map((p, i) => {
    const w = points.slice(Math.max(0, i - half), i + half + 1).map((q) => q[key]).filter((x) => x != null);
    return { ...p, s: w.length ? Math.round(mean(w) * 100) / 100 : null };
  });
}

/* Round axis bounds to a "nice" step so tick labels are 10, 15, 20 and not 13, 16, 19. */
function niceDomain(lo, hi, targetTicks = 4) {
  const span = Math.max(hi - lo, 1e-6);
  const raw = span / targetTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw) || 10 * mag;
  const dLo = Math.floor(lo / step) * step, dHi = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = dLo; v <= dHi + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return { dLo, dHi, ticks };
}

/* X axis = reading order. Each tick is labelled with the time of the reading sitting there. */
function useXAxis(visible) {
  const n = visible.length;
  const multiDay = n > 1 && visible[n - 1].t - visible[0].t > 20 * HOUR;
  const label = (idx) => {
    const h = visible[Math.min(n - 1, Math.max(0, Math.round(idx)))];
    if (!h) return "";
    return multiDay ? stamp(h.t, false) : clockSec(h.t);
  };
  const count = Math.min(6, Math.max(n, 1));
  const ticks = n <= 1 ? [0] : Array.from({ length: count }, (_, i) => Math.round((i * (n - 1)) / (count - 1)));
  return {
    type: "number", dataKey: "x", domain: [0, Math.max(n - 1, 1)], ticks, tickFormatter: label,
    tick: { fontSize: 12, fill: "#566b79" }, stroke: "#d3dde4", interval: 0, allowDecimals: false,
  };
}

/* Tooltip that names the time and says when a point is a bucket of several readings. */
function Tip({ active, payload, unit = "", label }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="ctip">
      <b>{stamp(p.t)}</b>
      {p.value != null && <div>{p.name}: <b>{p.value}{unit ? ` ${unit}` : ""}</b></div>}
      {p.n > 1 && <small>{p.n} readings{p.lo !== undefined ? ` · ${p.lo}–${p.hi}` : " · worst shown"}</small>}
      {p.tier && <div><TierBadge tier={p.tier} /></div>}
    </div>
  );
}

/* On crowded charts only the dangerous points keep a marker. */
const makeScoreDot = (crowded) => ({ cx, cy, payload }) => {
  if (cx == null || cy == null) return null;
  if (crowded && payload.tier !== "High") return null;
  return <circle cx={cx} cy={cy} r={crowded ? 5 : 7} fill={TIER[payload.tier].bar} stroke="#fff" strokeWidth={crowded ? 2 : 3} />;
};

/* ------------------------------------------------------------------ */
/*  One small chart per vital                                          */
/* ------------------------------------------------------------------ */
function VitalChart({ vital, readings, rules, xAxis, win }) {
  const nr = normalRange(rules, vital.param);

  const data = useMemo(() => {
    const raw = readings.filter((d) => d.v != null && !Number.isNaN(d.v));
    const sm = smooth(raw, "v", win);
    return bucketize(sm, MAX_POINTS, (g) => {
      const vs = g.map((x) => x.v), ss = g.map((x) => x.s).filter((x) => x != null);
      const mid = g[Math.floor(g.length / 2)];
      return {
        x: Math.round(mean(g.map((p) => p.x)) * 10) / 10, t: mid.t,
        v: Math.round(mean(vs) * 10) / 10, s: ss.length ? Math.round(mean(ss) * 10) / 10 : null,
        value: Math.round(mean(vs) * 10) / 10, name: vital.label,
        lo: Math.min(...vs), hi: Math.max(...vs), n: g.length,
      };
    });
  }, [readings, win, vital.label]);

  if (!data.length) return null;
  const vals = data.flatMap((d) => [d.v, d.s]).filter((v) => v != null);
  const dMin = Math.min(...vals), dMax = Math.max(...vals);
  const dSpan = Math.max(dMax - dMin, 1);
  const near = Math.max(dSpan, Math.abs(mean(vals)) * 0.25);   // only stretch the axis to a normal-range edge if it is close
  let lo = dMin, hi = dMax;
  if (nr?.min != null && Math.abs(nr.min - dMin) <= near) lo = Math.min(lo, nr.min);
  if (nr?.max != null && Math.abs(nr.max - dMax) <= near) hi = Math.max(hi, nr.max);
  const padv = Math.max((hi - lo) * 0.12, vital.key === "temperature" ? 0.2 : 1);
  const { dLo, dHi, ticks } = niceDomain(lo - padv, hi + padv, 4);
  const a = Math.max(nr?.min ?? dLo, dLo), b = Math.min(nr?.max ?? dHi, dHi);
  const showBand = nr && a < b;
  const few = data.length <= DOT_LIMIT;
  const smoothed = win > 1;
  const latest = readings[readings.length - 1].v;

  return (
    <div className="vchart">
      <div className="vchart-head">
        <b>{vital.label}</b>
        <small>{nr ? `Normal ${nr.min ?? "below"}${nr.min !== null && nr.max !== null ? "–" : ""}${nr.max ?? "+"} ${vital.unit}` : vital.unit}</small>
      </div>
      <div className="vchart-now">
        Latest <b>{showValue(vital, latest)}</b> {vital.unit}
        {data.length < readings.length && <small> · {readings.length} readings, thinned to {data.length} points</small>}
      </div>
      <ResponsiveContainer width="100%" height={170}>
        <LineChart data={data} margin={{ top: 6, right: 14, left: -8, bottom: 0 }}>
          {showBand && <ReferenceArea y1={a} y2={b} fill="#2fa36b" fillOpacity={0.14} />}
          <CartesianGrid stroke="#e3eaef" vertical={false} />
          <XAxis {...xAxis} />
          <YAxis domain={[dLo, dHi]} ticks={ticks} tick={{ fontSize: 11, fill: "#566b79" }} stroke="#d3dde4" allowDecimals={vital.key === "temperature"} />
          <Tooltip content={<Tip unit={vital.unit} />} />
          <Line type="linear" dataKey="v" name={vital.label} stroke="#12456b"
            strokeOpacity={smoothed ? 0.3 : 1} strokeWidth={smoothed ? 1.5 : 2.2}
            dot={few ? { r: smoothed ? 2 : 3.5, fill: "#12456b" } : false} activeDot={{ r: 5 }}
            connectNulls isAnimationActive={false} />
          {smoothed && (
            <Line type="monotone" dataKey="s" stroke="#12456b" strokeWidth={3}
              dot={false} activeDot={false} connectNulls isAnimationActive={false} tooltipType="none" />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */
export default function TrendView() {
  const rules = useRules();
  const live = useLive();
  const [params, setParams] = useSearchParams();
  const [patients, setPatients] = useState([]);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState(null);
  const [range, setRange] = useState("all");      // preset key, "all", "custom" or "last"
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [lastN, setLastN] = useState(50);
  const [win, setWin] = useState(5);
  const [showTable, setShowTable] = useState(true);
  const patientId = params.get("patient") || "";

  useEffect(() => { api.listPatients().then(setPatients).catch(() => {}); }, []);

  const load = useCallback(() => {
    if (!patientId) { setHistory([]); return; }
    api.patientHistory(patientId).then((h) => { setHistory(h); setError(null); }).catch((e) => setError(e.message));
  }, [patientId]);

  useEffect(() => { load(); }, [load]);

  // live refresh: when the server pushes anything, reload (debounced so a busy simulator doesn't hammer the API)
  const version = live?.version;
  useEffect(() => {
    if (!patientId || version === undefined) return;
    const id = setTimeout(load, 2000);
    return () => clearTimeout(id);
  }, [version, patientId, load]);

  const patient = patients.find((p) => String(p.patient_id) === patientId);

  // ---- apply the time range ----
  const sorted = useMemo(
    () => history.map((h) => ({ ...h, t: toMs(h.recorded_at) })).filter((h) => !Number.isNaN(h.t)).sort((a, b) => a.t - b.t),
    [history]
  );
  const end = sorted.length ? sorted[sorted.length - 1].t : 0;
  const first = sorted.length ? sorted[0].t : 0;
  const totalSpan = end - first;
  // only offer presets shorter than the data we actually have, so every button does something
  const presets = PRESETS.filter((p) => p.ms < totalSpan);
  const visible = useMemo(() => {
    if (!sorted.length) return [];
    if (range === "last") return sorted.slice(-Math.max(2, Math.min(Number(lastN) || 50, sorted.length)));
    if (range === "custom") {
      const f = fromInput(from), t = fromInput(to);
      return sorted.filter((h) => (Number.isNaN(f) || h.t >= f) && (Number.isNaN(t) || h.t <= t + 59999));
    }
    const p = PRESETS.find((x) => x.k === range);
    return p && p.ms < totalSpan ? sorted.filter((h) => h.t >= end - p.ms) : sorted;
  }, [sorted, range, from, to, lastN, end, totalSpan]);
  const pickCustom = () => {
    if (!from) setFrom(toInput(first));
    if (!to) setTo(toInput(end));
    setRange("custom");
  };
  const xAxis = useXAxis(visible);

  // ---- score series: worst score in each group so a spike is never averaged away ----
  const scoreData = useMemo(() => {
    const pts = visible.map((h, x) => ({ x, t: h.t, score: h.total_score, tier: h.risk_tier })).filter((p) => p.score != null);
    return bucketize(pts, MAX_POINTS, (g) => {
      const w = g.reduce((m, p) => (p.score > m.score ? p : m), g[0]);
      return { x: w.x, t: w.t, score: w.score, value: w.score, name: "EWS score", tier: w.tier, n: g.length };
    });
  }, [visible]);
  const maxScore = Math.max(0, ...scoreData.map((d) => d.score));
  const stepY = maxScore > 14 ? 4 : 2;
  const top = Math.max(10, Math.ceil((maxScore + 1) / stepY) * stepY);
  const scoreTicks = Array.from({ length: top / stepY + 1 }, (_, i) => i * stepY);

  // ---- per-vital series ----
  const vitalSeries = useMemo(() => {
    const out = {};
    VITALS.filter((v) => !v.kind).forEach((v) => {
      out[v.key] = visible.map((h, x) => ({ x, t: h.t, v: h[v.key] === null || h[v.key] === undefined ? null : Number(h[v.key]) }));
    });
    return out;
  }, [visible]);

  // ---- observation table: cap columns so it stays readable (most recent N) ----
  const TABLE_MAX = 14;
  const tableRows = visible.slice(-TABLE_MAX);
  const cols = tableRows.map((h) => ({ h, sc: scoreReading(rules, h) }));
  const crowded = scoreData.length > DOT_LIMIT;

  return (
    <section>
      <header className="page-head row">
        <div>
          <h1>Patient charts{patient ? `: ${patient.name}` : ""}</h1>
          <p className="sub">The observation chart works like the paper chart on the ward. Each cell is coloured by the points that value earns.</p>
        </div>
        <label className="field pick"><span>Patient</span>
          <select value={patientId} onChange={(e) => setParams(e.target.value ? { patient: e.target.value } : {})}>
            <option value="">Choose a patient</option>
            {patients.map((p) => <option key={p.patient_id} value={p.patient_id}>{p.name} · {p.ward_name}</option>)}
          </select>
        </label>
      </header>

      {error && <div className="error">{error}</div>}
      {!patientId && <div className="card empty">Choose a patient to see their charts.</div>}
      {patientId && history.length === 0 && !error && <div className="card empty">No readings for this patient yet. Save one from Log vitals.</div>}

      {history.length > 0 && (
        <>
          <div className="card ct-bar">
            <div className="ct-tool">
              <span>Time window</span>
              <div className="ct-seg" role="group" aria-label="Time window">
                {presets.map((x) => (
                  <button key={x.k} type="button" className={range === x.k ? "active" : ""} onClick={() => setRange(x.k)}>{x.label}</button>
                ))}
                <button type="button" className={range === "all" ? "active" : ""} onClick={() => setRange("all")}>All</button>
                <button type="button" className={range === "last" ? "active" : ""} onClick={() => setRange("last")}>Last N</button>
                <button type="button" className={range === "custom" ? "active" : ""} onClick={pickCustom}>Custom</button>
              </div>
            </div>
            {range === "custom" && (
              <div className="ct-tool">
                <span>From – To (UTC, as shown on the chart)</span>
                <div className="ct-inline">
                  <input type="datetime-local" className="ct-in" value={from} min={toInput(first)} max={to || toInput(end)} onChange={(e) => setFrom(e.target.value)} />
                  <b>→</b>
                  <input type="datetime-local" className="ct-in" value={to} min={from || toInput(first)} max={toInput(end)} onChange={(e) => setTo(e.target.value)} />
                  <button type="button" className="btn ghost small" onClick={() => { setFrom(toInput(first)); setTo(toInput(end)); }}>Reset</button>
                </div>
              </div>
            )}
            {range === "last" && (
              <div className="ct-tool">
                <span>Most recent readings: {Math.min(Number(lastN) || 2, sorted.length)}</span>
                <div className="ct-inline">
                  <input type="range" className="ct-slider" min={2} max={Math.max(2, sorted.length)} value={Math.min(lastN, sorted.length)} onChange={(e) => setLastN(Number(e.target.value))} />
                  <input type="number" className="ct-in ct-num" min={2} max={sorted.length} value={lastN} onChange={(e) => setLastN(e.target.value)} />
                </div>
              </div>
            )}
            <div className="ct-tool">
              <span>Smoothing (vital charts)</span>
              <div className="ct-seg" role="group" aria-label="Smoothing">
                {SMOOTH.map((x) => (
                  <button key={x.k} type="button" className={win === x.k ? "active" : ""} onClick={() => setWin(x.k)}>{x.label}</button>
                ))}
              </div>
            </div>
            <div className="ct-tool ct-grow">
              <small>
                Showing {visible.length} of {history.length} readings
                {visible.length > MAX_POINTS && ` · charts thin to ${MAX_POINTS} points (score keeps the worst value in each group)`}
              </small>
            </div>
          </div>

          {visible.length === 0 && <div className="card empty">No readings in this window. Widen the range or choose All.</div>}

          {visible.length > 0 && (
            <>
              <div className="card">
                <div className="card-title row-between">
                  <span>Observation chart{visible.length > TABLE_MAX ? ` (latest ${TABLE_MAX} readings)` : ""}</span>
                  <button type="button" className="btn ghost small" onClick={() => setShowTable((s) => !s)}>{showTable ? "Hide" : "Show"}</button>
                </div>
                {showTable && (
                  <>
                    <div className="obs-key">
                      Points: <i className="k0">0</i><i className="k1">1</i><i className="k2">2</i><i className="k3">3</i>
                    </div>
                    <div className="scroll">
                      <table className="obs">
                        <thead>
                          <tr><th />{cols.map(({ h }) => <th key={h.reading_id}>{stamp(h.t)}</th>)}</tr>
                        </thead>
                        <tbody>
                          {VITALS.map((v) => (
                            <tr key={v.key}>
                              <th scope="row">{v.label}<small>{v.unit}</small></th>
                              {cols.map(({ h, sc }) => {
                                const pts = sc.rows.find((row) => row.key === v.key).points;
                                return (
                                  <td key={h.reading_id} className={`o p${pts ?? 0}`}>
                                    {showValue(v, h[v.key])}{pts > 0 && <sup>+{pts}</sup>}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                          <tr className="total">
                            <th scope="row">EWS score</th>
                            {cols.map(({ h }) => (
                              <td key={h.reading_id} style={h.risk_tier ? { background: TIER[h.risk_tier].tint, color: TIER[h.risk_tier].color } : {}}>
                                {h.total_score ?? "–"}
                              </td>
                            ))}
                          </tr>
                          <tr>
                            <th scope="row">Risk</th>
                            {cols.map(({ h }) => <td key={h.reading_id}><TierBadge tier={h.risk_tier} /></td>)}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>

              {scoreData.length > 0 && (
                <div className="card">
                  <div className="card-title">Score over time</div>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={scoreData} margin={{ top: 10, right: 24, left: -10, bottom: 0 }}>
                      <ReferenceArea y1={0} y2={4.5} fill={TIER.Low.bar} fillOpacity={0.12} />
                      <ReferenceArea y1={4.5} y2={6.5} fill={TIER.Medium.bar} fillOpacity={0.16} />
                      <ReferenceArea y1={6.5} y2={top} fill={TIER.High.bar} fillOpacity={0.12} />
                      <ReferenceLine y={6.5} stroke={TIER.High.bar} strokeDasharray="4 4" />
                      <ReferenceLine y={4.5} stroke={TIER.Medium.bar} strokeDasharray="4 4" />
                      <CartesianGrid stroke="#e3eaef" vertical={false} />
                      <XAxis {...xAxis} />
                      <YAxis domain={[0, top]} ticks={scoreTicks} allowDecimals={false} tick={{ fontSize: 12, fill: "#566b79" }} stroke="#d3dde4"
                        label={{ value: "EWS score", angle: -90, position: "insideLeft", offset: 22, fontSize: 12, fill: "#566b79" }} />
                      <Tooltip content={<Tip />} />
                      <Line type="linear" dataKey="score" name="EWS score" stroke="#12456b" strokeWidth={crowded ? 2.4 : 3}
                        dot={makeScoreDot(crowded)} activeDot={{ r: 8 }} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                  <div className="obs-key">
                    <span style={{ color: TIER.Low.color }}>{TIER.Low.glyph} Low 0–4</span>
                    <span style={{ color: TIER.Medium.color }}>{TIER.Medium.glyph} Medium 5–6</span>
                    <span style={{ color: TIER.High.color }}>{TIER.High.glyph} High 7+</span>
                    <span>Readings are spaced evenly in the order they were taken; the labels show when.</span>
                    {crowded && <span>Markers shown only for High scores</span>}
                  </div>
                </div>
              )}

              <div className="card">
                <div className="card-title">Each vital over time</div>
                <p className="sub" style={{ marginTop: 0 }}>
                  The green band is the normal range from the scoring rules.
                  {win > 1 ? " The bold line is the smoothed trend; the faint line is the actual readings." : ""}
                </p>
                <div className="vgrid">
                  {VITALS.filter((v) => !v.kind).map((v) => (
                    <VitalChart key={v.key} vital={v} rules={rules} readings={vitalSeries[v.key]} xAxis={xAxis} win={win} />
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
