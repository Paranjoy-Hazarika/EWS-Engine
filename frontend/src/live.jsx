import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { api, getToken } from "./api.js";
import { useAuth } from "./auth.jsx";
import { startSiren, stopSiren, startTitleFlash, stopTitleFlash, notify, soundReady } from "./alarm.js";

const Live = createContext(null);
export const useLive = () => useContext(Live);

// One shared connection: the server pushes an event (Server-Sent Events) the moment anything changes,
// and every screen re-reads from this single source. No polling.
export function LiveProvider({ children }) {
  const { user } = useAuth();
  const canAlarm = !!user && user.role !== "Admin";      // alerts and alarms are for doctors and nurses only
  const [patients, setPatients] = useState([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const [lastEvent, setLastEvent] = useState(null);
  const [feed, setFeed] = useState([]);
  const [version, setVersion] = useState(0);
  const [updated, setUpdated] = useState(null);
  const [now, setNow] = useState(Date.now());
  const fetchedAt = useRef(Date.now());

  const refresh = useCallback(async () => {
    try {
      const rows = await api.dashboard();
      fetchedAt.current = Date.now();
      setPatients(rows); setError(null); setUpdated(new Date()); setVersion((v) => v + 1);
    } catch (e) { setError(e.message); }
  }, []);

  useEffect(() => {
    refresh();
    const es = new EventSource(`/api/stream?token=${encodeURIComponent(getToken() || "")}`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);      // EventSource reconnects by itself
    es.onmessage = (m) => {
      const ev = JSON.parse(m.data);
      if (ev.type === "hello") { refresh(); return; }
      if (ev.type === "tick") { refresh(); return; }
      setLastEvent(ev);
      if (ev.type === "reading") setFeed((f) => [{ ...ev, at: new Date() }, ...f].slice(0, 30));
      refresh();
    };
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { es.close(); clearInterval(clock); };
  }, [refresh]);

  // alarm state: unacknowledged Emergency alerts; "escalated" once the server-side age passes the limit
  const elapsed = Math.floor((now - fetchedAt.current) / 1000);
  const emergencies = (canAlarm ? patients : [])
    .filter((p) => p.alert_level === "Emergency" && !p.alert_acknowledged)
    .map((p) => ({ ...p, age: (p.alert_age_seconds ?? 0) + elapsed }));
  const escalated = emergencies.some((p) => p.escalated || p.age >= 60);
  const alarming = emergencies.length > 0;

  useEffect(() => {
    if (alarming && soundReady()) startSiren(escalated); else stopSiren(true);
    if (alarming) {
      startTitleFlash(`${emergencies.length} EMERGENCY`);
      emergencies.forEach((p) => notify(`${p.patient_id}-${p.alert_since}`, "EMERGENCY: " + p.name, `EWS ${p.total_score} (High). Immediate review needed.`));
    } else stopTitleFlash();
    return () => stopSiren(true);
  }, [alarming, escalated, emergencies.length, version]);   // eslint-disable-line

  const acknowledge = async (id, by) => { await api.acknowledge(id, by); refresh(); };

  return (
    <Live.Provider value={{ patients, connected, error, updated, feed, lastEvent, version, refresh, emergencies, escalated, alarming, acknowledge }}>
      {children}
    </Live.Provider>
  );
}
