import React, { useState } from "react";
import { useAuth } from "../auth.jsx";
import { Logo } from "./Topbar.jsx";

export default function Login() {
  const { login } = useAuth();
  const [u, setU] = useState(""); const [p, setP] = useState("");
  const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await login(u, p); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="login-wrap">
      <form className="card login" onSubmit={submit}>
        <div className="login-brand"><Logo size={34} /><div><h1>EWS Engine</h1><small>Early Warning Score system</small></div></div>
        <p className="sub">Staff sign-in. Authorised clinical staff only.</p>
        {err && <div className="error">{err}</div>}
        <label>Username<input value={u} onChange={(e) => setU(e.target.value)} autoFocus autoComplete="username" required /></label>
        <label>Password<input type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" required /></label>
        <button className="btn" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </div>
  );
}
