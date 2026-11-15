import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useLive } from "../live.jsx";
import { useAuth } from "../auth.jsx";
import { api } from "../api.js";
import { useRules } from "../hooks.js";
import { TIER, TIER_ORDER, VITALS, scoreReading, showValue, fmtClock } from "../utils.js";
import Sparkline from "./Sparkline.jsx";

const COLS = [["respiration_rate", "RR"], ["spo2", "SpO₂"], ["supplemental_o2", "O₂"], ["systolic_bp", "SBP"], ["pulse", "HR"], ["consciousness", "ACVPU"], ["temperature", "Temp"]];
const FILTERS = [["all", "All"], ["High", "High"], ["Medium", "Medium"], ["Low", "Low"], ["alerts", "With alerts"]];
const age = (dob) => { if (!dob) return null; const d = new Date(dob); return isNaN(d) ? null : Math.floor((Date.now() - d) / 31557600000); };

export default function Dashboard() {
  const rules = useRules();
  const nav = useNavigate();
  const { user } = useAuth();
  const isAdmin = user.role === "Admin";        // alerts are for doctors and nurses only
  const { patients: rows, error, updated, version } = useLive();
  const [hist, setHist] = useState({});
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    let off = false;
    Promise.all(rows.map((p) => api.patientHistory(p.patient_id).catch(() => []))).then((hs) => {
      if (off) return;
      const h = {}; rows.forEach((p, i) => { h[p.patient_id] = hs[i]; }); setHist(h);
    });
    return () => { off = true; };
  }, [version]); // eslint-disable-line

  const filters = isAdmin ? FILTERS.filter(([k]) => k !== "alerts") : FILTERS;
  const multi = new Set(rows.map((r) => r.hospital_id)).size > 1;
  const wardCount = new Set(rows.map((r) => r.ward_id)).size;
  const count = (t) => rows.filter((r) => r.risk_tier === t).length;
  const open = rows.filter((p) => p.alert_level !== "None").length;
  const unack = rows.filter((p) => p.alert_level === "Emergency" && !p.alert_acknowledged).length;
  const shown = rows
    .filter((p) => filter === "all" || (filter === "alerts" ? p.alert_level !== "None" : p.risk_tier === filter))
    .sort((a, b) => (TIER_ORDER[a.risk_tier] ?? 3) - (TIER_ORDER[b.risk_tier] ?? 3) || (b.total_score ?? -1) - (a.total_score ?? -1));

  return (
    <section>
      <header className="page-head row">
        <div><h1>Ward board</h1><p className="sub">Patients ranked by early warning score, sickest first. Updates live.</p></div>
        <div className="head-actions">
          <span className="stamp">{updated ? `Updated ${updated.toLocaleTimeString("en-GB")}` : "Loading…"}</span>
          <Link to="/vitals" className="btn small">Record observations</Link>
        </div>
      </header>
      {error && <div className="error">Can’t reach the server: {error}</div>}

      <div className="kpis">
        <div className="kpi"><small>Patients</small><b>{rows.length}</b></div>
        <div className="kpi high"><small>High risk</small><b>{count("High")}</b></div>
        <div className="kpi med"><small>Medium risk</small><b>{count("Medium")}</b></div>
        <div className="kpi low"><small>Low risk</small><b>{count("Low")}</b></div>
        {isAdmin
          ? <div className="kpi"><small>Wards</small><b>{wardCount}</b></div>
          : <Link to="/alerts" className={`kpi alert ${open ? "on" : ""}`}><small>Open alerts</small><b>{open}</b><em>{unack ? `${unack} awaiting acknowledgement` : open ? "all acknowledged" : "all clear"}</em></Link>}
      </div>

      <div className="card flush">
        <div className="toolbar">
          <div className="seg" role="tablist" aria-label="Filter patients">
            {filters.map(([k, label]) => <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{label}</button>)}
          </div>
          <div className="legend"><span>Cell colour = points for that vital:</span><i className="vc p0">0</i><i className="vc p1">1</i><i className="vc p2">2</i><i className="vc p3">3</i></div>
        </div>
        <div className="scroll">
          <table className="census">
            <thead><tr><th>Patient</th><th>EWS</th><th>Trend</th>{COLS.map(([, l]) => <th key={l} className="c">{l}</th>)}<th>Last obs</th>{!isAdmin && <th>Alert</th>}<th /></tr></thead>
            <tbody>
              {shown.map((p) => {
                const h = hist[p.patient_id] || [];
                const scores = h.filter((x) => x.total_score != null).slice(-8).map((x) => x.total_score);
                const latest = h[h.length - 1];
                const t = p.risk_tier ? TIER[p.risk_tier] : null;
                const sc = latest ? scoreReading(rules, latest) : null;
                const a = age(p.dob);
                const flash = p.alert_level === "Emergency" && !p.alert_acknowledged;
                return (
                  <tr key={p.patient_id} className={`row-${p.risk_tier || "none"} ${flash ? "flash" : ""}`} onClick={() => nav(`/trend?patient=${p.patient_id}`)}>
                    <td className="pt"><b>{p.name}</b><small>{a != null ? `${a} y · ` : ""}{multi ? `${p.hospital_name} · ` : ""}{p.ward_name}</small></td>
                    <td><span className="ews" style={t ? { background: t.tint, color: t.color, borderColor: t.bar } : null}>{p.total_score ?? "–"}</span><small className="tier" style={t ? { color: t.color } : null}>{t ? `${t.glyph} ${p.risk_tier}` : "Not scored"}</small></td>
                    <td className="tr"><Sparkline values={scores} color={t ? t.bar : "#9db0bd"} /></td>
                    {COLS.map(([k]) => {
                      const v = VITALS.find((x) => x.key === k);
                      const pts = sc ? sc.rows.find((r) => r.key === k)?.points : null;
                      return <td key={k} className="c"><span className={`vc p${pts ?? 0}`}>{latest ? showValue(v, latest[k]) : "–"}</span></td>;
                    })}
                    <td className="obs-t">{latest ? fmtClock(latest.recorded_at) : "—"}</td>
                    {!isAdmin && <td>{p.alert_level !== "None" ? <span className={`chip ${p.alert_level}`}>{p.alert_level === "Emergency" ? "Emergency" : "Warning"}{p.alert_acknowledged ? " · ack" : ""}</span> : <small>—</small>}</td>}
                    <td className="go">›</td>
                  </tr>
                );
              })}
              {shown.length === 0 && <tr><td colSpan={13} className="empty-row">{rows.length ? "No patients match this filter." : "No patients yet. Use Admit patient to add the first one."}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
