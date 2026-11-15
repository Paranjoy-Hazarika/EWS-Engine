import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { useRules } from "../hooks.js";
import { ALERT_INFO, TIER, normalizeDbTime, scoreReading, showValue } from "../utils.js";
import TierBadge from "./TierBadge.jsx";

const blank = {
  patient_id: "", recorded_at: "", respiration_rate: "", spo2: "", supplemental_o2: false,
  systolic_bp: "", pulse: "", consciousness: "Alert", temperature: "",
};
const PRESETS = {
  Stable: { respiration_rate: 16, spo2: 98, supplemental_o2: false, systolic_bp: 125, pulse: 72, consciousness: "Alert", temperature: 36.8 },
  Worsening: { respiration_rate: 22, spo2: 94, supplemental_o2: false, systolic_bp: 108, pulse: 95, consciousness: "Alert", temperature: 37.8 },
  Critical: { respiration_rate: 28, spo2: 90, supplemental_o2: true, systolic_bp: 88, pulse: 125, consciousness: "Voice", temperature: 39.2 },
};
const ACTION = {
  Low: "Routine monitoring.",
  Medium: "Urgent review by a clinician.",
  High: "Emergency response. Call the doctor now.",
};

function Num({ label, unit, field, form, update, step }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="with-unit">
        <input type="number" inputMode="decimal" step={step} value={form[field]} required
               onChange={(e) => update(field, e.target.value)} />
        <em>{unit}</em>
      </div>
    </label>
  );
}

export default function VitalsForm() {
  const rules = useRules();
  const [patients, setPatients] = useState([]);
  const [params] = useSearchParams();
  const [form, setForm] = useState({ ...blank, patient_id: params.get("patient") || "" });
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.listPatients().then(setPatients).catch(() => {}); }, []);

  const update = (field, value) => setForm((f) => ({ ...f, [field]: value }));
  const preview = useMemo(() => scoreReading(rules, form), [rules, form]);

  const submit = async (e) => {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      const res = await api.logVital({
        patient_id: Number(form.patient_id),
        recorded_at: normalizeDbTime(form.recorded_at),
        respiration_rate: Number(form.respiration_rate), spo2: Number(form.spo2),
        supplemental_o2: form.supplemental_o2, systolic_bp: Number(form.systolic_bp),
        pulse: Number(form.pulse), consciousness: form.consciousness, temperature: Number(form.temperature),
      });
      setSaved(res);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const another = () => { setSaved(null); setForm((f) => ({ ...blank, patient_id: f.patient_id })); };

  return (
    <section>
      <header className="page-head">
        <h1>Log vitals</h1>
        <p className="sub">Enter one set of observations. The panel on the right scores it as you type.</p>
      </header>

      <div className="split">
        <form className="card" onSubmit={submit}>
          <div className="grid2">
            <label className="field"><span>Patient</span>
              <select value={form.patient_id} onChange={(e) => update("patient_id", e.target.value)} required>
                <option value="">Choose a patient</option>
                {patients.map((p) => <option key={p.patient_id} value={p.patient_id}>{p.name} · {p.ward_name}</option>)}
              </select>
            </label>
            <label className="field"><span>Time taken <small>(blank means now)</small></span>
              <input type="datetime-local" value={form.recorded_at} onChange={(e) => update("recorded_at", e.target.value)} />
            </label>
          </div>

          <div className="presets">
            <span>Demo values:</span>
            {Object.keys(PRESETS).map((n) => (
              <button type="button" key={n} className="btn ghost small" onClick={() => setForm((f) => ({ ...f, ...PRESETS[n] }))}>{n}</button>
            ))}
          </div>

          <fieldset>
            <legend>Breathing</legend>
            <div className="grid3">
              <Num label="Respiration rate" unit="per min" field="respiration_rate" form={form} update={update} />
              <Num label="Oxygen saturation" unit="%" field="spo2" form={form} update={update} />
              <label className="field"><span>On supplemental oxygen</span>
                <select value={String(form.supplemental_o2)} onChange={(e) => update("supplemental_o2", e.target.value === "true")}>
                  <option value="false">No</option><option value="true">Yes</option>
                </select>
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend>Circulation</legend>
            <div className="grid3">
              <Num label="Systolic blood pressure" unit="mmHg" field="systolic_bp" form={form} update={update} />
              <Num label="Pulse" unit="bpm" field="pulse" form={form} update={update} />
            </div>
          </fieldset>

          <fieldset>
            <legend>Alertness and temperature</legend>
            <div className="grid3">
              <label className="field"><span>Consciousness (ACVPU)</span>
                <select value={form.consciousness} onChange={(e) => update("consciousness", e.target.value)}>
                  <option>Alert</option><option>Voice</option><option>Pain</option><option>Unresponsive</option>
                </select>
              </label>
              <Num label="Temperature" unit="°C" field="temperature" form={form} update={update} step="0.1" />
            </div>
          </fieldset>

          {error && <div className="error">{error}</div>}
          <button type="submit" className="btn" disabled={busy}>{busy ? "Saving…" : "Save reading"}</button>
        </form>

        <aside className="card side" aria-live="polite">
          {saved ? (
            <div className="saved-box" style={{ borderColor: TIER[saved.risk_tier].color }}>
              <div className="card-title">Saved</div>
              <div className="bigscore" style={{ color: TIER[saved.risk_tier].color }}>{saved.total_score}</div>
              <TierBadge tier={saved.risk_tier} big />
              <p className="action">{ACTION[saved.risk_tier]}</p>
              {(saved.alert_raised ? [{ alert_type: saved.alert_type }] : []).map((a) => (
                <div key={a.alert_type} className="inline-alert" style={{ borderColor: ALERT_INFO[a.alert_type].color, background: ALERT_INFO[a.alert_type].tint }}>
                  <b style={{ color: ALERT_INFO[a.alert_type].color }}>{ALERT_INFO[a.alert_type].title}</b>
                  <span>{ALERT_INFO[a.alert_type].text}</span>
                </div>
              ))}
              <button className="btn" onClick={another}>Log another reading</button>
            </div>
          ) : (
            <>
              <div className="card-title">Live score check</div>
              <table className="pv">
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.key}>
                      <td>{r.label}</td>
                      <td className="val">{showValue(r, r.raw)} <small>{r.raw === "" ? "" : r.unit}</small></td>
                      <td><span className={`pts p${r.points ?? "x"}`}>{r.points === null ? "·" : r.points}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="pv-total">
                <span>{preview.complete ? "Expected score" : "Fill every field to see the score"}</span>
                {preview.complete && (
                  <div><b style={{ color: TIER[preview.tier].color }}>{preview.total}</b> <TierBadge tier={preview.tier} /></div>
                )}
              </div>
              <p className="fine">This is a preview. The saved score comes from the server.</p>
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
