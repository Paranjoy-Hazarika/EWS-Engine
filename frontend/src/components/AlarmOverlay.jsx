import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useLive } from "../live.jsx";
import { enableSound, soundReady } from "../alarm.js";

const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// Emergency alert panel for doctors and nurses. It is docked at the top right of the screen, stays
// visible on every page until the alert is acknowledged, and does not block the screen. The siren
// (alarm.js) is unchanged. Admin never sees this: the server sends no alerts to Admin.
export default function AlarmOverlay({ who }) {
  const { emergencies, escalated, acknowledge } = useLive();
  const [busy, setBusy] = useState(null);
  const [, force] = useState(0);
  if (!emergencies.length) return null;

  const ack = async (id) => { setBusy(id); try { await acknowledge(id, who); } finally { setBusy(null); } };
  const many = emergencies.length > 1;
  const action = who === "Doctor" ? "Review the patient now." : "Check the patient and inform the doctor.";

  return (
    <aside className={`adock ${escalated ? "esc" : ""}`} role="alert" aria-live="assertive" aria-label="Emergency alert">
      <header className="adock-head">
        <div>
          <b>{many ? `${emergencies.length} emergency alerts` : "Emergency alert"}</b>
          <span>{action}</span>
        </div>
        {!soundReady() && <button type="button" className="adock-link" onClick={() => { enableSound(); force((n) => n + 1); }}>Turn on sound</button>}
      </header>

      {escalated && (
        <p className="adock-esc">Not acknowledged within the time limit. Inform the senior doctor or the rapid response team.</p>
      )}

      <ul className="adock-list">
        {emergencies.map((p) => (
          <li key={p.patient_id}>
            <div className="adock-top">
              <div><b>{p.name}</b><small>{p.ward_name}</small></div>
              <span className="adock-ews">EWS {p.total_score}<small>High risk</small></span>
            </div>
            <dl className="adock-vitals">
              <div><dt>RR</dt><dd>{p.respiration_rate ?? "–"}</dd></div>
              <div><dt>SpO₂</dt><dd>{p.spo2 != null ? `${p.spo2}%` : "–"}</dd></div>
              <div><dt>BP</dt><dd>{p.systolic_bp ?? "–"}</dd></div>
              <div><dt>HR</dt><dd>{p.pulse ?? "–"}</dd></div>
              <div><dt>Temp</dt><dd>{p.temperature ?? "–"}</dd></div>
            </dl>
            <div className="adock-foot">
              <small>Waiting {mmss(p.age)}</small>
              <span>
                <Link to={`/trend?patient=${p.patient_id}`} className="btn ghost small">View charts</Link>{" "}
                <button type="button" className="btn small" disabled={busy === p.patient_id} onClick={() => ack(p.patient_id)}>
                  {busy === p.patient_id ? "Saving…" : "Acknowledge"}
                </button>
              </span>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
