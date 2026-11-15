import React, { useState } from "react";
import { Routes, Route, NavLink, Navigate } from "react-router-dom";
import Dashboard from "./components/Dashboard.jsx";
import VitalsForm from "./components/VitalsForm.jsx";
import TrendView from "./components/TrendView.jsx";
import AlertsPanel from "./components/AlertsPanel.jsx";
import AdminRules from "./components/AdminRules.jsx";
import AddPatient from "./components/AddPatient.jsx";
import Icon from "./components/Icon.jsx";
import LiveMonitor from "./components/LiveMonitor.jsx";
import AlarmOverlay from "./components/AlarmOverlay.jsx";
import { LiveProvider } from "./live.jsx";
import { useAuth } from "./auth.jsx";
import Login from "./components/Login.jsx";
import Account from "./components/Account.jsx";
import Topbar from "./components/Topbar.jsx";
import Hospitals from "./components/Hospitals.jsx";
import { useScope } from "./scope.jsx";

export default function App() {
  const { user, ready, logout } = useAuth();
  const { hospitalId } = useScope();
  if (!ready) return <div className="login-wrap">Loading…</div>;
  if (!user) return <Login />;
  const role = user.role;

  return (
    <LiveProvider key={hospitalId || "all"}>
    {role !== "Admin" && <AlarmOverlay who={role} />}
    <div className="shell">
      <Topbar />
      <aside className="rail">
        <nav>
          <div className="nav-h">Clinical</div>
          <NavLink to="/" end><Icon name="board" />Ward board</NavLink>
          <NavLink to="/live"><Icon name="chart" />Live monitor</NavLink>
          <NavLink to="/trend"><Icon name="chart" />Patient charts</NavLink>
          {role !== "Admin" && <NavLink to="/alerts"><Icon name="bell" />Alerts</NavLink>}
          <div className="nav-h">Actions</div>
          <NavLink to="/vitals"><Icon name="plus" />Record observations</NavLink>
          <NavLink to="/patients/new"><Icon name="user" />Admit patient</NavLink>
          <div className="nav-h">System</div>
          <NavLink to="/account"><Icon name="user" />My account{role === "Admin" ? " & staff" : ""}</NavLink>
          {role === "Admin" && <NavLink to="/hospitals"><Icon name="board" />Hospitals & wards</NavLink>}
          {role === "Admin" && <NavLink to="/admin"><Icon name="sliders" />Scoring rules</NavLink>}
        </nav>
        <div className="rail-foot">Clinical decision support.<br />Not a substitute for clinical judgement.</div>
      </aside>

      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/vitals" element={<VitalsForm />} />
          <Route path="/patients/new" element={<AddPatient />} />
          <Route path="/trend" element={<TrendView />} />
          <Route path="/account" element={<Account />} />
          <Route path="/live" element={<LiveMonitor role={role} />} />
          {role !== "Admin" && <Route path="/alerts" element={<AlertsPanel who={role} />} />}
          {role === "Admin" && <Route path="/hospitals" element={<Hospitals />} />}
          {role === "Admin" && <Route path="/admin" element={<AdminRules />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
    </LiveProvider>
  );
}
