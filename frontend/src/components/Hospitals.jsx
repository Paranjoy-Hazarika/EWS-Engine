import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { useScope } from "../scope.jsx";

// Admin: register hospitals and their wards. Doctors and nurses are assigned to one hospital
// (My account & staff) and only see that hospital's patients and alerts.
export default function Hospitals() {
  const { reload } = useScope();
  const [list, setList] = useState([]);
  const [msg, setMsg] = useState(null);
  const [form, setForm] = useState({ name: "", address: "", wards: "" });
  const [newWard, setNewWard] = useState({});          // hospital_id -> text being typed

  const load = () => api.hospitals().then(setList).catch((e) => setMsg({ bad: e.message }));
  useEffect(() => { load(); }, []);   // eslint-disable-line

  const run = async (fn, ok) => {
    try { await fn(); setMsg(ok ? { ok } : null); await load(); reload(); return true; }
    catch (e) { setMsg({ bad: e.message }); return false; }
  };

  const addHospital = async (e) => {
    e.preventDefault();
    const wards = form.wards.split("\n").map((w) => w.trim()).filter(Boolean);
    const done = await run(() => api.addHospital({ name: form.name, address: form.address, wards }), `${form.name.trim()} was registered.`);
    if (done) setForm({ name: "", address: "", wards: "" });
  };

  const addWard = async (h) => {
    const name = (newWard[h.hospital_id] || "").trim();
    if (!name) return;
    const done = await run(() => api.addWard(h.hospital_id, name), `Ward added to ${h.name}.`);
    if (done) setNewWard((n) => ({ ...n, [h.hospital_id]: "" }));
  };

  const renameHospital = (h) => {
    const name = window.prompt("Hospital name", h.name);
    if (name && name.trim() !== h.name) run(() => api.updateHospital(h.hospital_id, { name }), "Hospital renamed.");
  };
  const editAddress = (h) => {
    const address = window.prompt("Address", h.address || "");
    if (address !== null) run(() => api.updateHospital(h.hospital_id, { address }), "Address saved.");
  };
  const removeHospital = (h) => {
    if (window.confirm(`Remove ${h.name} and its empty wards? This cannot be undone.`)) run(() => api.deleteHospital(h.hospital_id), `${h.name} was removed.`);
  };
  const renameWard = (w) => {
    const name = window.prompt("Ward name", w.name);
    if (name && name.trim() !== w.name) run(() => api.renameWard(w.ward_id, name), "Ward renamed.");
  };
  const removeWard = (w) => {
    if (window.confirm(`Remove the ward "${w.name}"?`)) run(() => api.deleteWard(w.ward_id), "Ward removed.");
  };

  return (
    <section>
      <header className="page-head">
        <h1>Hospitals &amp; wards</h1>
        <p className="sub">Register every hospital and its wards here. A doctor or nurse is assigned to one hospital and only sees that hospital’s patients and alerts. Admins can switch between hospitals from the top bar.</p>
      </header>
      {msg && <div className={msg.bad ? "error" : "success"}>{msg.bad || msg.ok}</div>}

      <form className="card hosp-form" onSubmit={addHospital}>
        <div className="card-title">Register a hospital</div>
        <div className="grid2">
          <label className="field"><span>Hospital name</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Tezpur District Hospital" required />
          </label>
          <label className="field"><span>Address <small>(optional)</small></span>
            <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Town, state" />
          </label>
        </div>
        <label className="field" style={{ marginTop: 14 }}><span>Wards <small>(optional, one per line. You can add more later)</small></span>
          <textarea rows={3} value={form.wards} onChange={(e) => setForm({ ...form, wards: e.target.value })} placeholder={"General Ward A\nHigh Dependency Unit"} />
        </label>
        <div style={{ marginTop: 16 }}><button className="btn">Register hospital</button></div>
      </form>

      {list.length === 0 && <div className="card empty">No hospitals yet.</div>}

      {list.map((h) => (
        <div className="card" key={h.hospital_id}>
          <div className="hosp-head">
            <div>
              <h2>{h.name}</h2>
              <small>{h.address || "No address"} · {h.wards.length} ward{h.wards.length === 1 ? "" : "s"} · {h.patient_count} patient{h.patient_count === 1 ? "" : "s"} · {h.staff_count} doctor/nurse account{h.staff_count === 1 ? "" : "s"}</small>
            </div>
            <div className="hosp-actions">
              <button className="btn ghost small" onClick={() => renameHospital(h)}>Rename</button>
              <button className="btn ghost small" onClick={() => editAddress(h)}>Edit address</button>
              <button className="btn ghost small" disabled={h.patient_count > 0 || h.staff_count > 0}
                title={h.patient_count > 0 || h.staff_count > 0 ? "Only a hospital with no patients and no staff can be removed" : ""}
                onClick={() => removeHospital(h)}>Remove</button>
            </div>
          </div>

          <table className="pv hosp-wards">
            <thead><tr><th>Ward</th><th>Patients</th><th /></tr></thead>
            <tbody>
              {h.wards.map((w) => (
                <tr key={w.ward_id}>
                  <td><b>{w.name}</b></td>
                  <td>{w.patient_count}</td>
                  <td className="r">
                    <button className="btn ghost small" onClick={() => renameWard(w)}>Rename</button>{" "}
                    <button className="btn ghost small" disabled={w.patient_count > 0} title={w.patient_count > 0 ? "Only an empty ward can be removed" : ""} onClick={() => removeWard(w)}>Remove</button>
                  </td>
                </tr>
              ))}
              {h.wards.length === 0 && <tr><td colSpan={3}><small>No wards yet. Add the first one below.</small></td></tr>}
            </tbody>
          </table>

          <div className="hosp-addward">
            <input value={newWard[h.hospital_id] || ""} placeholder="New ward name"
              onChange={(e) => setNewWard({ ...newWard, [h.hospital_id]: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addWard(h); } }} />
            <button className="btn small" type="button" onClick={() => addWard(h)}>Add ward</button>
          </div>
        </div>
      ))}
    </section>
  );
}
