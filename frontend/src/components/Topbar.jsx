import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth.jsx";
import { useLive } from "../live.jsx";
import { useScope } from "../scope.jsx";

export function Logo({ size = 30 }) {
  return (
    <svg width={size * 1.5} height={size} viewBox="0 0 54 30" aria-hidden="true">
      <path d="M1 16 H15 L19 6 L26 26 L31 12 L34 16 H53" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Topbar() {
  const { user, logout } = useAuth();
  const { patients, connected } = useLive();
  const { hospitals, hospitalId, setHospitalId } = useScope();
  const isAdmin = user.role === "Admin";
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const open = patients.filter((p) => p.alert_level !== "None").length;
  const unack = patients.filter((p) => p.alert_level === "Emergency" && !p.alert_acknowledged).length;
  const initials = user.full_name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

  return (
    <header className="topbar">
      <Link to="/" className="tb-brand"><Logo /><span><b>EWS Engine</b><small>Early Warning Score</small></span></Link>
      {isAdmin ? (
        <div className="tb-site">
          <select className="tb-hosp" aria-label="Hospital" value={hospitalId} onChange={(e) => setHospitalId(e.target.value)}>
            <option value="">All hospitals</option>
            {hospitals.map((h) => <option key={h.hospital_id} value={h.hospital_id}>{h.name}</option>)}
          </select>
          <small>{hospitalId ? "Showing one hospital" : `${hospitals.length} hospital${hospitals.length === 1 ? "" : "s"}`}</small>
        </div>
      ) : (
        <div className="tb-site">{user.hospital_name || "No hospital assigned"}<small>{user.hospital_name ? "Inpatient wards" : "Ask an administrator to assign you"}</small></div>
      )}
      <div className="tb-right">
        <div className={`tb-live ${connected ? "on" : "off"}`}><i />{connected ? "Live" : "Reconnecting"}</div>
        <div className="tb-clock">{now.toLocaleTimeString("en-GB")}<small>{now.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" })}</small></div>
        {!isAdmin && <Link to="/alerts" className={`tb-bell ${unack ? "crit" : open ? "warn" : ""}`} title="Open alerts">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 17V11a6 6 0 1 1 12 0v6l2 2H4zM10 21a2 2 0 0 0 4 0" /></svg>
          {open > 0 && <span>{open}</span>}
        </Link>}
        <div className="tb-user">
          <div className="avatar" aria-hidden="true">{initials}</div>
          <div className="who"><b>{user.full_name}</b><small>{user.role}</small></div>
          <button className="btn ghost small" onClick={logout}>Sign out</button>
        </div>
      </div>
    </header>
  );
}
