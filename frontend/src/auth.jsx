import React, { createContext, useContext, useEffect, useState } from "react";
import { api, getToken, setToken, clearToken } from "./api.js";

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const logout = () => { clearToken(); localStorage.removeItem("ews_hospital"); setUser(null); };

  useEffect(() => {
    if (!getToken()) { setReady(true); return; }
    api.me().then(setUser).catch(clearToken).finally(() => setReady(true));
    window.addEventListener("ews-unauth", logout);
    return () => window.removeEventListener("ews-unauth", logout);
  }, []);

  const login = async (u, p) => { const r = await api.login(u, p); setToken(r.token); setUser(r.user); };
  return <Ctx.Provider value={{ user, ready, login, logout }}>{children}</Ctx.Provider>;
}
