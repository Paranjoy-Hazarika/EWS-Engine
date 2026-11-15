import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { fmtDate } from "../utils.js";

const today = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export default function AddPatient() {
  const { user } = useAuth();
  const [patients, setPatients] = useState([]);
  const [wards, setWards] = useState([]);
  const [wardId, setWardId] = useState("");
  const [form, setForm] = useState({ name: "", dob: "", admission_date: today() });
  const [added, setAdded] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.listPatients().then(setPatients).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    api.wards().then((w) => { setWards(w); setWardId((cur) => cur || (w[0] ? String(w[0].ward_id) : "")); }).catch((e) => setError(e.message));
  }, []);

  const update = (field, value) => setForm((f) => ({ ...f, [field]: value }));
  const name = form.name.trim();
  const duplicate = name && patients.some((p) => String(p.ward_id) === wardId && p.name.trim().toLowerCase() === name.toLowerCase());
  const hospitalsShown = [...new Set(wards.map((w) => w.hospital_name))];
  const ward = wards.find((w) => String(w.ward_id) === wardId);

  const submit = async (e) => {
    e.preventDefault();
    setError(null); setAdded(null);
    if (!wardId) { setError("Choose a ward."); return; }
    if (!name) { setError("Enter the patient’s name."); return; }
    if (form.dob && form.dob > today()) { setError("Date of birth can’t be in the future."); return; }
    setBusy(true);
    try {
      const res = await api.createPatient({ ward_id: Number(wardId), name, dob: form.dob || null, admission_date: form.admission_date });
      setAdded({ id: res.patient_id, name, ward: ward?.name });
      setForm({ name: "", dob: "", admission_date: today() });
      load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <section>
      <header className="page-head">
        <h1>Add patient</h1>
        <p className="sub">Admit a new patient to a ward. Once added, they appear on the ward board and in Record observations.</p>
      </header>

      <div className="split">
        <form className="card" onSubmit={submit}>
          {wards.length === 0 ? (
            <div className="inline-alert" style={{ borderColor: "#a85f00", background: "#fff1d6", marginBottom: 14 }}>
              <b style={{ color: "#a85f00" }}>There is no ward to admit into.</b>
              <span>{user.role === "Admin" ? <>Register a hospital and its wards in <Link to="/hospitals">Hospitals &amp; wards</Link>.</> : "Ask an administrator to add a ward to your hospital."}</span>
            </div>
          ) : (
            <label className="field"><span>Ward{hospitalsShown.length === 1 ? <small> · {hospitalsShown[0]}</small> : null}</span>
              <select value={wardId} onChange={(e) => setWardId(e.target.value)} required>
                {hospitalsShown.length > 1
                  ? hospitalsShown.map((hn) => (
                      <optgroup key={hn} label={hn}>
                        {wards.filter((w) => w.hospital_name === hn).map((w) => <option key={w.ward_id} value={w.ward_id}>{w.name}</option>)}
                      </optgroup>
                    ))
                  : wards.map((w) => <option key={w.ward_id} value={w.ward_id}>{w.name}</option>)}
              </select>
            </label>
          )}
          <label className="field" style={{ marginTop: 14 }}><span>Full name</span>
            <input value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="e.g. Ravi Das" autoFocus />
          </label>
          {duplicate && (
            <div className="inline-alert" style={{ borderColor: "#a85f00", background: "#fff1d6", marginTop: 12 }}>
              <b style={{ color: "#a85f00" }}>A patient with this name is already on this ward.</b>
              <span>Add a date of birth so the two can be told apart.</span>
            </div>
          )}
          <div className="grid2" style={{ marginTop: 16 }}>
            <label className="field"><span>Date of birth <small>(optional)</small></span>
              <input type="date" max={today()} value={form.dob} onChange={(e) => update("dob", e.target.value)} />
            </label>
            <label className="field"><span>Admission date</span>
              <input type="date" required value={form.admission_date} onChange={(e) => update("admission_date", e.target.value)} />
            </label>
          </div>

          {error && <div className="error">{error}</div>}
          {added && (
            <div className="success">
              <b>{added.name} was added{added.ward ? ` to ${added.ward}` : ""}.</b>
              <Link to={`/vitals?patient=${added.id}`}>Log their first vitals</Link>
            </div>
          )}
          <div style={{ marginTop: 18 }}>
            <button type="submit" className="btn" disabled={busy || !wards.length}>{busy ? "Saving…" : "Add patient"}</button>
          </div>
        </form>

        <aside className="card">
          <div className="card-title">Patients now ({patients.length})</div>
          {patients.length === 0 ? (
            <p className="sub">No patients yet.</p>
          ) : (
            <table className="plist">
              <thead><tr><th>Name</th><th>Ward</th><th>Admitted</th></tr></thead>
              <tbody>
                {patients.map((p) => (
                  <tr key={p.patient_id}>
                    <td><b>{p.name}</b></td><td>{p.ward_name}</td><td>{fmtDate(p.admission_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </aside>
      </div>
    </section>
  );
}
