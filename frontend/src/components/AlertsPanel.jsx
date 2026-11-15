import React, { useState } from "react";
import { api } from "../api.js";
import { useLive } from "../live.jsx";
import { ALERT_INFO, fmtDateTime } from "../utils.js";

export default function AlertsPanel({ who }) {
  const { patients, error, refresh } = useLive();
  const [err, setErr] = useState(null);
  const alerts = patients
    .filter((p) => p.alert_level !== "None")
    .sort((a, b) => (a.alert_level === b.alert_level ? 0 : a.alert_level === "Emergency" ? -1 : 1));

  const run = async (fn) => { try { await fn(); await refresh(); setErr(null); } catch (e) { setErr(e.message); } };

  return (
    <section>
      <header className="page-head">
        <h1>Alerts</h1>
        <p className="sub">Acknowledge an alert to silence the alarm, then mark it as reviewed to clear it. A cleared alert can be raised again if the patient gets worse.</p>
      </header>
      {(err || error) && <div className="error">{err || error}</div>}
      {alerts.length === 0 && <div className="card empty">No active alerts.</div>}
      <div className="alert-list">
        {alerts.map((a) => {
          const info = ALERT_INFO[a.alert_type] || { title: a.alert_type, text: "" };
          return (
            <article key={a.patient_id} className={`acard ${a.alert_level}`}>
              <div className="body">
                <div className="who">
                  {a.name} <span className={`chip ${a.alert_level}`}>{a.alert_level}</span>
                  {!a.alert_acknowledged && <span className="tag-open">Not acknowledged</span>}
                </div>
                <div className="what"><b>{info.title}.</b> {info.text} EWS {a.total_score}.</div>
                <time>
                  {a.ward_name} · Raised {fmtDateTime(a.alert_since)}
                  {a.alert_acknowledged ? ` · Acknowledged by ${a.acknowledged_by}, ${fmtDateTime(a.acknowledged_at)}` : ""}
                </time>
              </div>
              <div className="acard-actions">
                {!a.alert_acknowledged && <button className="btn small" onClick={() => run(() => api.acknowledge(a.patient_id, who))}>Acknowledge</button>}
                <button className="btn ghost small" onClick={() => run(() => api.resolveAlert(a.patient_id))}>Mark as reviewed</button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
