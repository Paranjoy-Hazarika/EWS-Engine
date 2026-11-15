import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "./api.js";
import { useAuth } from "./auth.jsx";

// Which hospital is on screen. Doctors and nurses are fixed to the hospital they work at.
// Admin can pick one hospital or look at all of them.
const Ctx = createContext(null);
export const useScope = () => useContext(Ctx);

export function ScopeProvider({ children }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "Admin";
  const [hospitals, setHospitals] = useState([]);
  const [hospitalId, setId] = useState(localStorage.getItem("ews_hospital") || "");

  const setHospitalId = useCallback((id) => {
    if (id) localStorage.setItem("ews_hospital", String(id)); else localStorage.removeItem("ews_hospital");
    setId(id ? String(id) : "");
  }, []);

  const reload = useCallback(
    () => (user ? api.hospitals().then(setHospitals).catch(() => {}) : Promise.resolve()),
    [user]
  );
  useEffect(() => { reload(); }, [reload]);

  // nobody but Admin has a choice; and forget a choice whose hospital has since been removed
  useEffect(() => {
    if (user && !isAdmin && hospitalId) setHospitalId("");
    if (isAdmin && hospitalId && hospitals.length && !hospitals.some((h) => String(h.hospital_id) === hospitalId)) setHospitalId("");
  }, [user, isAdmin, hospitalId, hospitals, setHospitalId]);

  return (
    <Ctx.Provider value={{ hospitals, hospitalId: isAdmin ? hospitalId : "", setHospitalId, reload, isAdmin }}>
      {children}
    </Ctx.Provider>
  );
}
