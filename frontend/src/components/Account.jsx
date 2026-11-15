import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { useScope } from "../scope.jsx";

export default function Account() {
  const { user } = useAuth();
  const { hospitals } = useScope();
  const [pw, setPw] = useState({ old: "", next: "" });
  const [msg, setMsg] = useState(null);
  const [staff, setStaff] = useState([]);
  const [form, setForm] = useState({ username: "", full_name: "", role: "Nurse", password: "", hospital_id: "" });
  const isAdmin = user.role === "Admin";
  const load = () => isAdmin && api.staff().then(setStaff).catch((e) => setMsg({ bad: e.message }));
  useEffect(() => { load(); }, []);   // eslint-disable-line
  const run = async (fn, ok) => { try { await fn(); setMsg({ ok }); load(); } catch (e) { setMsg({ bad: e.message }); } };

  return (
    <section>
      <header className="page-head"><h1>Account</h1><p className="sub">Signed in as {user.full_name} ({user.role}).</p></header>
      {msg && <div className={msg.bad ? "error" : "card"}>{msg.bad || msg.ok}</div>}
      <form className="card acct" onSubmit={(e) => { e.preventDefault(); run(() => api.changePassword(pw.old, pw.next), "Password changed."); setPw({ old: "", next: "" }); }}>
        <div className="card-title">Change my password</div>
        <label>Current password<input type="password" value={pw.old} onChange={(e) => setPw({ ...pw, old: e.target.value })} required /></label>
        <label>New password (8+ characters)<input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} minLength={8} required /></label>
        <button className="btn">Change password</button>
      </form>

      {isAdmin && (
        <>
          <form className="card acct" onSubmit={(e) => { e.preventDefault(); run(() => api.addStaff({ ...form, hospital_id: form.role === "Admin" ? null : Number(form.hospital_id) }), "Staff account created."); setForm({ ...form, username: "", full_name: "", password: "" }); }}>
            <div className="card-title">Add staff</div>
            <label>Username<input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required /></label>
            <label>Full name<input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required /></label>
            <label>Role<select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{["Doctor", "Nurse", "Admin"].map((r) => <option key={r}>{r}</option>)}</select></label>
            {form.role !== "Admin" && (
              <label>Hospital<select value={form.hospital_id} onChange={(e) => setForm({ ...form, hospital_id: e.target.value })} required>
                <option value="">Choose a hospital</option>
                {hospitals.map((h) => <option key={h.hospital_id} value={h.hospital_id}>{h.name}</option>)}
              </select></label>
            )}
            <label>Temporary password (8+)<input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={8} required /></label>
            <button className="btn">Create account</button>
          </form>
          <div className="card">
            <div className="card-title">Staff accounts</div>
            <table className="pv"><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Hospital</th><th>Status</th><th></th></tr></thead>
              <tbody>{staff.map((s) => (
                <tr key={s.staff_id}><td>{s.full_name}</td><td>{s.username}</td><td>{s.role}</td>
                  <td>{s.role === "Admin" ? <small>All hospitals</small> : (
                    <select value={s.hospital_id ?? ""} onChange={(e) => run(() => api.updateStaff(s.staff_id, { hospital_id: Number(e.target.value) }), "Hospital updated.")}>
                      {s.hospital_id == null && <option value="">Not assigned</option>}
                      {hospitals.map((h) => <option key={h.hospital_id} value={h.hospital_id}>{h.name}</option>)}
                    </select>)}</td>
                  <td>{s.active ? "Active" : "Disabled"}</td>
                  <td>
                    <button className="btn ghost" onClick={() => run(() => api.updateStaff(s.staff_id, { active: !s.active }), s.active ? "Account disabled." : "Account enabled.")}>{s.active ? "Disable" : "Enable"}</button>{" "}
                    <button className="btn ghost" onClick={() => { const p = window.prompt(`New password for ${s.username} (8+ characters)`); if (p) run(() => api.updateStaff(s.staff_id, { password: p }), "Password reset."); }}>Reset password</button>
                  </td></tr>))}</tbody></table>
          </div>
        </>
      )}
    </section>
  );
}
