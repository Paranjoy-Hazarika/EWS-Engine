import os, time
from flask import Flask, request, jsonify, Response, stream_with_context, g, send_from_directory
from werkzeug.exceptions import HTTPException
from flask_cors import CORS
from db import get_connection
from dbutil import tx, JsonProvider, patient_hospital
from scoring import record_reading, load_history, now_str
import events, simulator
import auth
from auth import require

ESCALATE_AFTER = int(os.getenv("ESCALATE_AFTER_SECONDS", "60"))   # unacknowledged emergency escalates

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
SIM_ENABLED = os.getenv("ENABLE_SIMULATOR", "1") == "1"
app = Flask(__name__, static_folder=None)
app.json = JsonProvider(app)
if os.getenv("CORS_ORIGINS"):
    CORS(app, origins=os.getenv("CORS_ORIGINS").split(","))
auth.ensure_default_staff()

PATIENT_COLS = """p.patient_id, p.ward_id, w.name AS ward_name, w.hospital_id, h.name AS hospital_name,
  p.name, p.dob, p.admission_date,
  p.last_recorded_at, p.respiration_rate, p.spo2, p.supplemental_o2, p.systolic_bp, p.pulse,
  p.consciousness, p.temperature, p.total_score, p.risk_tier, p.alert_level, p.alert_type,
  p.alert_since, p.alert_acknowledged, p.acknowledged_by, p.acknowledged_at,
  TIMESTAMPDIFF(SECOND, p.alert_since, NOW()) AS alert_age_seconds"""
ORDER = "ORDER BY FIELD(p.alert_level,'Emergency','Warning','None'), FIELD(p.risk_tier,'High','Medium','Low'), p.total_score DESC, p.name"
NO_ALERT = dict(alert_level="None", alert_type="none", alert_since=None, alert_acknowledged=False,
                acknowledged_by=None, acknowledged_at=None, alert_age_seconds=None)


def _is_admin():
    return g.user["role"] == "Admin"


def _scope():
    """Which hospital the signed-in user may see.
    Doctors and nurses are fixed to their own hospital (someone with none assigned sees nothing).
    Admin sees every hospital, or just one if ?hospital_id= is given."""
    if not _is_admin():
        return g.user["hospital_id"] if g.user["hospital_id"] is not None else -1
    return request.args.get("hospital_id", type=int)


def _may_see(cur, pid):
    """True if the patient exists and belongs to a hospital the user may see."""
    hid = patient_hospital(cur, pid)
    if hid is None:
        return False
    return _is_admin() or hid == g.user["hospital_id"]


def _decorate(rows):
    hide_alerts = g.user["role"] not in auth.ALERT_ROLES      # alerts are for doctors and nurses only
    for r in rows:
        if hide_alerts:
            r.update(NO_ALERT)
        age = r.get("alert_age_seconds")
        r["escalated"] = bool(r["alert_level"] == "Emergency" and not r["alert_acknowledged"]
                              and age is not None and age >= ESCALATE_AFTER)
    return rows


def _fetch_patients(extra="", params=()):
    conds, args = [], list(params)
    hid = _scope()
    if hid is not None:
        conds.append("w.hospital_id = %s")
        args.append(hid)
    if extra:
        conds.append(extra)
    where = ("WHERE " + " AND ".join(conds)) if conds else ""
    with tx() as cur:
        cur.execute(f"SELECT {PATIENT_COLS} FROM PATIENT p JOIN WARD w ON w.ward_id = p.ward_id "
                    f"JOIN HOSPITAL h ON h.hospital_id = w.hospital_id {where} {ORDER}", args)
        return _decorate(cur.fetchall())


@app.errorhandler(404)
def _nf(e):
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(Exception)
def _err(e):
    if isinstance(e, HTTPException):
        return jsonify({"error": e.description}), e.code
    app.logger.exception(e)
    return jsonify({"error": "Server error"}), 500


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/wards")
@require()
def wards():
    hid = _scope()
    with tx() as cur:
        cur.execute("SELECT w.ward_id, w.name, w.hospital_id, h.name AS hospital_name FROM WARD w "
                    "JOIN HOSPITAL h ON h.hospital_id = w.hospital_id "
                    + ("WHERE w.hospital_id = %s " if hid is not None else "") + "ORDER BY h.name, w.name",
                    (hid,) if hid is not None else ())
        return jsonify(cur.fetchall())


# ---------- hospitals and wards (Admin manages them; staff can only read their own hospital) ----------
def _clean(v, n):
    return str(v or "").strip()[:n]


@app.get("/api/hospitals")
@require()
def hospitals():
    mine = None if _is_admin() else (g.user["hospital_id"] if g.user["hospital_id"] is not None else -1)
    with tx() as cur:
        cur.execute("SELECT hospital_id, name, address FROM HOSPITAL " + ("WHERE hospital_id = %s " if mine is not None else "")
                    + "ORDER BY name", (mine,) if mine is not None else ())
        hs = cur.fetchall()
        cur.execute("SELECT w.ward_id, w.hospital_id, w.name, (SELECT COUNT(*) FROM PATIENT p WHERE p.ward_id = w.ward_id) AS patient_count "
                    "FROM WARD w ORDER BY w.name")
        ws = cur.fetchall()
        cur.execute("SELECT hospital_id, COUNT(*) AS n FROM STAFF WHERE hospital_id IS NOT NULL AND active = 1 GROUP BY hospital_id")
        staff = {r["hospital_id"]: r["n"] for r in cur.fetchall()}
    for h in hs:
        h["wards"] = [w for w in ws if w["hospital_id"] == h["hospital_id"]]
        h["patient_count"] = sum(w["patient_count"] for w in h["wards"])
        h["staff_count"] = staff.get(h["hospital_id"], 0)
    return jsonify(hs)


@app.post("/api/hospitals")
@require("Admin")
def hospital_create():
    d = request.get_json(silent=True) or {}
    name, address = _clean(d.get("name"), 120), _clean(d.get("address"), 200)
    ward_names = [_clean(w, 80) for w in (d.get("wards") or []) if _clean(w, 80)]
    if not name:
        return jsonify({"error": "Enter the hospital name"}), 400
    if len({w.lower() for w in ward_names}) != len(ward_names):
        return jsonify({"error": "Two of the wards have the same name"}), 400
    with tx() as cur:
        cur.execute("SELECT 1 FROM HOSPITAL WHERE LOWER(name) = LOWER(%s)", (name,))
        if cur.fetchone():
            return jsonify({"error": "A hospital with this name already exists"}), 400
        cur.execute("INSERT INTO HOSPITAL (name, address) VALUES (%s, %s)", (name, address or None))
        hid = cur.lastrowid
        for w in ward_names:
            cur.execute("INSERT INTO WARD (hospital_id, name) VALUES (%s, %s)", (hid, w))
    events.publish({"type": "patient", "hospital_id": hid})
    return jsonify({"hospital_id": hid}), 201


@app.patch("/api/hospitals/<int:hid>")
@require("Admin")
def hospital_update(hid):
    d = request.get_json(silent=True) or {}
    with tx() as cur:
        cur.execute("SELECT hospital_id FROM HOSPITAL WHERE hospital_id = %s", (hid,))
        if cur.fetchone() is None:
            return jsonify({"error": "Hospital not found"}), 404
        if "name" in d:
            name = _clean(d["name"], 120)
            if not name:
                return jsonify({"error": "The hospital name cannot be empty"}), 400
            cur.execute("SELECT 1 FROM HOSPITAL WHERE LOWER(name) = LOWER(%s) AND hospital_id <> %s", (name, hid))
            if cur.fetchone():
                return jsonify({"error": "A hospital with this name already exists"}), 400
            cur.execute("UPDATE HOSPITAL SET name = %s WHERE hospital_id = %s", (name, hid))
        if "address" in d:
            cur.execute("UPDATE HOSPITAL SET address = %s WHERE hospital_id = %s", (_clean(d["address"], 200) or None, hid))
    events.publish({"type": "patient", "hospital_id": hid})
    return jsonify({"ok": True})


@app.delete("/api/hospitals/<int:hid>")
@require("Admin")
def hospital_delete(hid):
    with tx() as cur:
        cur.execute("SELECT COUNT(*) AS n FROM PATIENT p JOIN WARD w ON w.ward_id = p.ward_id WHERE w.hospital_id = %s", (hid,))
        if cur.fetchone()["n"]:
            return jsonify({"error": "This hospital still has patients. Only an empty hospital can be removed."}), 400
        cur.execute("SELECT COUNT(*) AS n FROM STAFF WHERE hospital_id = %s", (hid,))
        if cur.fetchone()["n"]:
            return jsonify({"error": "Staff are still assigned to this hospital. Move or remove them first."}), 400
        cur.execute("DELETE FROM WARD WHERE hospital_id = %s", (hid,))
        cur.execute("DELETE FROM HOSPITAL WHERE hospital_id = %s", (hid,))
        if cur.rowcount == 0:
            return jsonify({"error": "Hospital not found"}), 404
    events.publish({"type": "patient", "hospital_id": hid})
    return jsonify({"ok": True})


@app.post("/api/hospitals/<int:hid>/wards")
@require("Admin")
def ward_create(hid):
    name = _clean((request.get_json(silent=True) or {}).get("name"), 80)
    if not name:
        return jsonify({"error": "Enter the ward name"}), 400
    with tx() as cur:
        cur.execute("SELECT hospital_id FROM HOSPITAL WHERE hospital_id = %s", (hid,))
        if cur.fetchone() is None:
            return jsonify({"error": "Hospital not found"}), 404
        cur.execute("SELECT 1 FROM WARD WHERE hospital_id = %s AND LOWER(name) = LOWER(%s)", (hid, name))
        if cur.fetchone():
            return jsonify({"error": "This hospital already has a ward with that name"}), 400
        cur.execute("INSERT INTO WARD (hospital_id, name) VALUES (%s, %s)", (hid, name))
        wid = cur.lastrowid
    events.publish({"type": "patient", "hospital_id": hid})
    return jsonify({"ward_id": wid}), 201


@app.patch("/api/wards/<int:wid>")
@require("Admin")
def ward_update(wid):
    name = _clean((request.get_json(silent=True) or {}).get("name"), 80)
    if not name:
        return jsonify({"error": "The ward name cannot be empty"}), 400
    with tx() as cur:
        cur.execute("SELECT hospital_id FROM WARD WHERE ward_id = %s", (wid,))
        row = cur.fetchone()
        if row is None:
            return jsonify({"error": "Ward not found"}), 404
        cur.execute("SELECT 1 FROM WARD WHERE hospital_id = %s AND LOWER(name) = LOWER(%s) AND ward_id <> %s", (row["hospital_id"], name, wid))
        if cur.fetchone():
            return jsonify({"error": "This hospital already has a ward with that name"}), 400
        cur.execute("UPDATE WARD SET name = %s WHERE ward_id = %s", (name, wid))
    events.publish({"type": "patient", "hospital_id": row["hospital_id"]})
    return jsonify({"ok": True})


@app.delete("/api/wards/<int:wid>")
@require("Admin")
def ward_delete(wid):
    with tx() as cur:
        cur.execute("SELECT hospital_id FROM WARD WHERE ward_id = %s", (wid,))
        row = cur.fetchone()
        if row is None:
            return jsonify({"error": "Ward not found"}), 404
        cur.execute("SELECT COUNT(*) AS n FROM PATIENT WHERE ward_id = %s", (wid,))
        if cur.fetchone()["n"]:
            return jsonify({"error": "This ward still has patients. Only an empty ward can be removed."}), 400
        cur.execute("DELETE FROM WARD WHERE ward_id = %s", (wid,))
    events.publish({"type": "patient", "hospital_id": row["hospital_id"]})
    return jsonify({"ok": True})


@app.post("/api/patients")
@require()
def create_patient():
    d = request.get_json(force=True)
    for f in ("ward_id", "name", "admission_date"):
        if d.get(f) in (None, ""):
            return jsonify({"error": f"Missing field: {f}"}), 400
    with tx() as cur:
        cur.execute("SELECT hospital_id FROM WARD WHERE ward_id = %s", (d["ward_id"],))
        ward = cur.fetchone()
        if ward is None or (not _is_admin() and ward["hospital_id"] != g.user["hospital_id"]):
            return jsonify({"error": "Choose a ward in your hospital"}), 400
        cur.execute("INSERT INTO PATIENT (ward_id, name, dob, admission_date, readings) VALUES (%s,%s,%s,%s,'[]')",
                    (d["ward_id"], d["name"].strip(), d.get("dob") or None, d["admission_date"]))
        pid = cur.lastrowid
    events.publish({"type": "patient", "patient_id": pid, "hospital_id": ward["hospital_id"]})
    return jsonify({"patient_id": pid}), 201


@app.get("/api/patients")
@app.get("/api/dashboard")
@require()
def patients():
    return jsonify(_fetch_patients())


@app.post("/api/vitals")
@require()
def log_vital():
    d = request.get_json(force=True)
    if d.get("patient_id") is None:
        return jsonify({"error": "Missing field: patient_id"}), 400
    try:
        with tx() as cur:
            if not _may_see(cur, int(d["patient_id"])):
                return jsonify({"error": "Patient not found"}), 404
            res = record_reading(cur, int(d["patient_id"]), d, d.get("recorded_at") or None)
            hid = patient_hospital(cur, int(d["patient_id"]))
    except LookupError as e:
        return jsonify({"error": str(e)}), 404
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    events.publish({"type": "reading", "hospital_id": hid, **{k: res[k] for k in ("patient_id", "name", "total_score", "risk_tier", "alert_raised", "alert_level", "alert_type")}})
    if g.user["role"] not in auth.ALERT_ROLES:
        res = {k: v for k, v in res.items() if k not in ("alert_level", "alert_type", "alert_raised")}
    return jsonify(res), 201


@app.get("/api/patients/<int:pid>/history")
@require()
def history(pid):
    with tx() as cur:
        allowed = _may_see(cur, pid)
        cur.execute("SELECT readings FROM PATIENT WHERE patient_id = %s", (pid,))
        row = cur.fetchone()
    if row is None or not allowed:
        return jsonify({"error": "Patient not found"}), 404
    out = load_history(row["readings"])
    for h in out:
        h["recorded_at"] = h["recorded_at"].replace(" ", "T") + "Z"
    return jsonify(out)


@app.get("/api/alerts")
@require(*auth.ALERT_ROLES)
def alerts():
    return jsonify(_fetch_patients("p.alert_level <> 'None'"))


@app.patch("/api/patients/<int:pid>/acknowledge")
@require(*auth.ALERT_ROLES)
def acknowledge(pid):
    by = f"{g.user['full_name']} ({g.user['role']})"
    with tx() as cur:
        if not _may_see(cur, pid):
            return jsonify({"error": "No active alert for this patient"}), 404
        cur.execute("UPDATE PATIENT SET alert_acknowledged = 1, acknowledged_by = %s, acknowledged_at = %s "
                    "WHERE patient_id = %s AND alert_level <> 'None'", (by[:60], now_str(), pid))
        if cur.rowcount == 0:
            return jsonify({"error": "No active alert for this patient"}), 404
    events.publish({"type": "ack", "patient_id": pid, "hospital_id": g.user["hospital_id"]})
    return jsonify({"patient_id": pid, "acknowledged": True})


@app.patch("/api/patients/<int:pid>/resolve")
@require(*auth.ALERT_ROLES)
def resolve(pid):
    with tx() as cur:
        if not _may_see(cur, pid):
            return jsonify({"error": "Patient not found"}), 404
        cur.execute("UPDATE PATIENT SET alert_level='None', alert_type='none', alert_since=NULL, "
                    "alert_acknowledged=0, acknowledged_by=NULL, acknowledged_at=NULL WHERE patient_id = %s", (pid,))
        if cur.rowcount == 0:
            return jsonify({"error": "Patient not found"}), 404
    events.publish({"type": "resolve", "patient_id": pid, "hospital_id": g.user["hospital_id"]})
    return jsonify({"patient_id": pid, "resolved": True})


@app.get("/api/scoring-rules")
@require()
def rules():
    with tx() as cur:
        cur.execute("SELECT sr.*, vp.name AS parameter_name FROM SCORING_RULE sr "
                    "JOIN VITAL_PARAMETER vp ON vp.parameter_id = sr.parameter_id ORDER BY sr.parameter_id, sr.range_min")
        return jsonify(cur.fetchall())


@app.put("/api/scoring-rules/<int:rid>")
@require("Admin")
def update_rule(rid):
    d = request.get_json(force=True)
    for f in ("range_min", "range_max", "score"):
        if f not in d:
            return jsonify({"error": f"Missing field: {f}"}), 400
    try:
        lo, hi, sc = float(d["range_min"]), float(d["range_max"]), int(d["score"])
    except (TypeError, ValueError):
        return jsonify({"error": "Range and score must be numbers"}), 400
    if lo > hi or not 0 <= sc <= 3:
        return jsonify({"error": "Need min <= max and score between 0 and 3"}), 400
    with tx() as cur:
        cur.execute("UPDATE SCORING_RULE SET range_min=%s, range_max=%s, score=%s WHERE rule_id=%s", (lo, hi, sc, rid))
        if cur.rowcount == 0:
            cur.execute("SELECT rule_id FROM SCORING_RULE WHERE rule_id=%s", (rid,))
            if cur.fetchone() is None:
                return jsonify({"error": "Scoring rule not found"}), 404
    return jsonify({"rule_id": rid, "updated": True})


@app.get("/api/simulator")
@require()
def sim_status():
    return jsonify({**simulator.status(), "enabled": SIM_ENABLED})


@app.post("/api/simulator/<action>")
@require("Admin")
def sim_control(action):
    if not SIM_ENABLED:
        return jsonify({"error": "Simulator is disabled on this server"}), 403
    if action == "start":
        return jsonify(simulator.start((request.get_json(silent=True) or {}).get("interval", 5)))
    if action == "stop":
        return jsonify(simulator.stop())
    return jsonify({"error": "Unknown action"}), 400



@app.post("/api/auth/login")
def login():
    d = request.get_json(silent=True) or {}
    u, pw = str(d.get("username", "")).strip().lower(), str(d.get("password", ""))
    if auth.check_lock(u):
        return jsonify({"error": "Too many failed attempts. Try again in 5 minutes."}), 429
    with tx() as cur:
        cur.execute("SELECT s.*, h.name AS hospital_name FROM STAFF s LEFT JOIN HOSPITAL h ON h.hospital_id = s.hospital_id "
                    "WHERE s.username=%s AND s.active=1", (u,))
        row = cur.fetchone()
    if not row or not auth.verify_password(row["password_hash"], pw):
        auth.note_failure(u)
        return jsonify({"error": "Wrong username or password"}), 401
    auth.clear_failures(u)
    user = {k: row[k] for k in ("staff_id", "username", "full_name", "role", "hospital_id", "hospital_name")}
    return jsonify({"token": auth.make_token(row["staff_id"]), "user": user})


@app.get("/api/auth/me")
@require()
def me():
    return jsonify(g.user)


@app.post("/api/auth/password")
@require()
def change_password():
    d = request.get_json(silent=True) or {}
    new = str(d.get("new_password", ""))
    if len(new) < 8:
        return jsonify({"error": "New password must be at least 8 characters"}), 400
    with tx() as cur:
        cur.execute("SELECT password_hash FROM STAFF WHERE staff_id=%s", (g.user["staff_id"],))
        if not auth.verify_password(cur.fetchone()["password_hash"], str(d.get("old_password", ""))):
            return jsonify({"error": "Current password is wrong"}), 400
        cur.execute("UPDATE STAFF SET password_hash=%s WHERE staff_id=%s", (auth.hash_password(new), g.user["staff_id"]))
    return jsonify({"ok": True})


@app.get("/api/staff")
@require("Admin")
def staff_list():
    with tx() as cur:
        cur.execute("SELECT s.staff_id, s.username, s.full_name, s.role, s.active, s.created_at, s.hospital_id, h.name AS hospital_name "
                    "FROM STAFF s LEFT JOIN HOSPITAL h ON h.hospital_id = s.hospital_id ORDER BY s.role, s.username")
        return jsonify(cur.fetchall())


def _hospital_exists(cur, hid):
    cur.execute("SELECT 1 FROM HOSPITAL WHERE hospital_id = %s", (hid,))
    return cur.fetchone() is not None


@app.post("/api/staff")
@require("Admin")
def staff_create():
    d = request.get_json(silent=True) or {}
    u, n, r, pw = str(d.get("username", "")).strip().lower(), str(d.get("full_name", "")).strip(), d.get("role"), str(d.get("password", ""))
    if not u or not n or r not in auth.ROLES or len(pw) < 8:
        return jsonify({"error": "Username, full name, role and a password of 8+ characters are required"}), 400
    hid = None
    if r in auth.ALERT_ROLES:                      # doctors and nurses work at exactly one hospital
        hid = d.get("hospital_id")
        if not hid:
            return jsonify({"error": "Choose the hospital this doctor or nurse works at"}), 400
    try:
        with tx() as cur:
            if hid is not None and not _hospital_exists(cur, hid):
                return jsonify({"error": "Hospital not found"}), 400
            cur.execute("INSERT INTO STAFF (username, full_name, role, password_hash, hospital_id) VALUES (%s,%s,%s,%s,%s)",
                        (u, n, r, auth.hash_password(pw), hid))
    except Exception:
        return jsonify({"error": "That username already exists"}), 400
    return jsonify({"ok": True}), 201


@app.patch("/api/staff/<int:sid>")
@require("Admin")
def staff_update(sid):
    d = request.get_json(silent=True) or {}
    if sid == g.user["staff_id"] and d.get("active") is False:
        return jsonify({"error": "You cannot deactivate your own account"}), 400
    with tx() as cur:
        if "active" in d:
            cur.execute("UPDATE STAFF SET active=%s WHERE staff_id=%s", (1 if d["active"] else 0, sid))
        if d.get("password"):
            if len(str(d["password"])) < 8:
                return jsonify({"error": "Password must be at least 8 characters"}), 400
            cur.execute("UPDATE STAFF SET password_hash=%s WHERE staff_id=%s", (auth.hash_password(str(d["password"])), sid))
        if "hospital_id" in d:
            cur.execute("SELECT role FROM STAFF WHERE staff_id=%s", (sid,))
            row = cur.fetchone()
            if row is None:
                return jsonify({"error": "Staff member not found"}), 404
            if row["role"] in auth.ALERT_ROLES:
                if not d["hospital_id"] or not _hospital_exists(cur, d["hospital_id"]):
                    return jsonify({"error": "Choose a valid hospital"}), 400
                cur.execute("UPDATE STAFF SET hospital_id=%s WHERE staff_id=%s", (d["hospital_id"], sid))
    return jsonify({"ok": True})


@app.get("/api/stream")
@require()
def stream():
    """Server-Sent Events: pushes a message the moment any reading/alert/ack changes."""
    hid = None if _is_admin() else (g.user["hospital_id"] if g.user["hospital_id"] is not None else -1)
    q = events.subscribe(hid, g.user["role"] in auth.ALERT_ROLES)

    def gen():
        try:
            yield events.sse_format({"type": "hello"})
            while True:
                try:
                    yield events.sse_format(q.get(timeout=10))
                except Exception:
                    yield events.sse_format({"type": "tick"})   # heartbeat + lets escalation timers refresh
        finally:
            events.unsubscribe(q)

    return Response(stream_with_context(gen()), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"})


@app.get("/", defaults={"path": ""})
@app.get("/<path:path>")
def spa(path):
    """Serve the built React app (single-process deployment)."""
    if path.startswith("api/") or not os.path.isdir(STATIC):
        return jsonify({"error": "Not found"}), 404
    if path and os.path.isfile(os.path.join(STATIC, path)):
        return send_from_directory(STATIC, path)
    return send_from_directory(STATIC, "index.html")


if __name__ == "__main__":
    app.run(debug=False, threaded=True, port=5000)
