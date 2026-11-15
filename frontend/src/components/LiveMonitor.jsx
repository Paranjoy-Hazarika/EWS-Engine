import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { useLive } from "../live.jsx";
import { enableSound, soundReady } from "../alarm.js";
import { TIER, fmtClock } from "../utils.js";
import TierBadge from "./TierBadge.jsx";

export default function LiveMonitor({ role }) {
  const { patients, feed, connected } = useLive();
  const [sim, setSim] = useState({ running: false, interval: 5, ticks: 0 });
  const [interval, setIntervalSec] = useState(5);
  const [sound, setSound] = useState(soundReady());
  const [err, setErr] = useState(null);

  useEffect(() => { api.simStatus().then(setSim).catch((e) => setErr(e.message)); }, [feed.length]);

  const toggle = async () => {
    try { setSim(await api.simControl(sim.running ? "stop" : "start", interval)); setErr(null); }
    catch (e) { setErr(e.message); }
  };

  return (
    <section>
      <header className="page-head row">
        <div>
          <h1>Live monitor</h1>
          <p className="sub">A bedside-monitor simulator sends a new reading for every patient. Scores, alerts and the alarm update instantly, with no refresh.</p>
        </div>
        <div className="live"><i style={{ background: connected ? "#2fa36b" : "#c62828" }} /> {connected ? "Live stream connected" : "Reconnecting…"}</div>
      </header>
      {err && <div className="error">{err}</div>}

      {sim.enabled === false ? <div className="card sub">The simulator is disabled on this server. Live readings arrive from Log vitals.</div> : <div className="card sim-bar">
        <button className={`btn ${sim.running ? "stop" : ""}`} onClick={toggle} disabled={role !== "Admin"} title={role !== "Admin" ? "Only an Admin can run the simulator" : ""}>{sim.running ? "■ Stop simulator" : "▶ Start simulator"}</button>
        <label>New reading every
          <select value={interval} disabled={sim.running} onChange={(e) => setIntervalSec(Number(e.target.value))}>
            {[2, 3, 5, 8, 10].map((n) => <option key={n} value={n}>{n} s</option>)}
          </select>
        </label>
        <button className="btn ghost" onClick={() => setSound(enableSound())}>{sound ? "🔊 Alarm sound on" : "🔈 Enable alarm sound"}</button>
        <small>{sim.running ? `Running · ${sim.ticks} rounds sent` : "Stopped"}</small>
      </div>}

      <div className="mon-grid">
        {patients.map((p) => {
          const t = p.risk_tier ? TIER[p.risk_tier] : null;
          return (
            <div key={p.patient_id} className={`mon ${p.alert_level === "Emergency" && !p.alert_acknowledged ? "flash" : ""}`} style={{ borderTopColor: t ? t.bar : "#d3dde4" }}>
              <div className="bed-top"><h3>{p.name}</h3><TierBadge tier={p.risk_tier} /></div>
              <div className="mon-score" style={{ color: t ? t.color : "#566b79" }}>{p.total_score ?? "–"}</div>
              <div className="mon-vitals">
                <span>RR <b>{p.respiration_rate ?? "–"}</b></span><span>SpO₂ <b>{p.spo2 ?? "–"}</b></span>
                <span>BP <b>{p.systolic_bp ?? "–"}</b></span><span>HR <b>{p.pulse ?? "–"}</b></span>
                <span>T <b>{p.temperature ?? "–"}</b></span><span>{p.consciousness ?? "–"}</span>
              </div>
              {p.alert_level !== "None" && <div className={`chip ${p.alert_level}`}>{p.alert_level}{p.alert_acknowledged ? " · acknowledged" : ""}</div>}
            </div>
          );
        })}
      </div>

      <div className="card">
        <div className="card-title">Incoming readings</div>
        {feed.length === 0 ? <p className="sub">Nothing yet. Start the simulator.</p> : (
          <ul className="feed">
            {feed.map((e, i) => (
              <li key={i}>
                <time>{fmtClock(e.at)}</time> <b>{e.name}</b> scored <b>{e.total_score}</b> ({e.risk_tier})
                {e.alert_raised && <span className={`chip ${e.alert_level}`}>{e.alert_level} raised</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
