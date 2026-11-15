const BASE = "/api";

export const getToken = () => localStorage.getItem("ews_token");
export const setToken = (t) => localStorage.setItem("ews_token", t);
export const clearToken = () => localStorage.removeItem("ews_token");
const auth = () => (getToken() ? { Authorization: `Bearer ${getToken()}` } : {});

async function handle(res) {
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && getToken()) window.dispatchEvent(new Event("ews-unauth"));   // expired or deactivated
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}
// Admin can look at one hospital at a time; the server ignores this for doctors and nurses (they are fixed to their own).
const scoped = (url) => {
  const h = localStorage.getItem("ews_hospital");
  return h ? `${url}${url.includes("?") ? "&" : "?"}hospital_id=${encodeURIComponent(h)}` : url;
};
const get = (url) => fetch(`${BASE}${url}`, { headers: auth() }).then(handle);
const send = (method, url, body) =>
  fetch(`${BASE}${url}`, { method, headers: { "Content-Type": "application/json", ...auth() }, body: body ? JSON.stringify(body) : undefined }).then(handle);

export const api = {
  login: (username, password) => send("POST", "/auth/login", { username, password }),
  me: () => get("/auth/me"),
  changePassword: (old_password, new_password) => send("POST", "/auth/password", { old_password, new_password }),
  staff: () => get("/staff"),
  addStaff: (p) => send("POST", "/staff", p),
  updateStaff: (id, p) => send("PATCH", `/staff/${id}`, p),
  listPatients: () => get(scoped("/patients")),
  wards: () => get(scoped("/wards")),
  hospitals: () => get("/hospitals"),
  addHospital: (p) => send("POST", "/hospitals", p),
  updateHospital: (id, p) => send("PATCH", `/hospitals/${id}`, p),
  deleteHospital: (id) => send("DELETE", `/hospitals/${id}`),
  addWard: (hid, name) => send("POST", `/hospitals/${hid}/wards`, { name }),
  renameWard: (id, name) => send("PATCH", `/wards/${id}`, { name }),
  deleteWard: (id) => send("DELETE", `/wards/${id}`),
  createPatient: (p) => send("POST", "/patients", p),
  logVital: (p) => send("POST", "/vitals", p),
  patientHistory: (id) => get(`/patients/${id}/history`),
  dashboard: () => get(scoped("/dashboard")),
  listAlerts: () => get(scoped("/alerts")),
  acknowledge: (id, by) => send("PATCH", `/patients/${id}/acknowledge`, { by }),
  resolveAlert: (id) => send("PATCH", `/patients/${id}/resolve`),
  listScoringRules: () => get("/scoring-rules"),
  updateScoringRule: (id, p) => send("PUT", `/scoring-rules/${id}`, p),
  simStatus: () => get("/simulator"),
  simControl: (action, interval) => send("POST", `/simulator/${action}`, { interval }),
};
