import json, os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import pytest
from app import app

class Client:
    """Test client that signs in as a given staff user."""
    def __init__(self, user="nurse"):
        self.c = app.test_client()
        r = self.c.post("/api/auth/login", json={"username": user, "password": os.getenv("INITIAL_PASSWORD", "ChangeMe123!")}).get_json()
        self.h = {"Authorization": "Bearer " + r["token"]}
    def _w(m):
        return lambda self, url, **k: getattr(self.c, m)(url, headers=self.h, **k)
    get, post, patch, put, delete = _w("get"), _w("post"), _w("patch"), _w("put"), _w("delete")

@pytest.fixture(scope="module")
def c():
    return Client("nurse")

def test_auth_rules():
    anon = app.test_client()
    assert anon.get("/api/dashboard").status_code == 401
    assert anon.post("/api/auth/login", json={"username": "nurse", "password": "wrong"}).status_code == 401
    assert Client("nurse").put("/api/scoring-rules/1", json={"range_min": 0, "range_max": 1, "score": 0}).status_code == 403
    assert Client("admin").get("/api/staff").status_code == 200
    assert Client("nurse").get("/api/staff").status_code == 403

def vit(**kw):
    v = dict(respiration_rate=16, spo2=98, supplemental_o2=0, systolic_bp=125, pulse=76, consciousness="Alert", temperature=36.8)
    v.update(kw); return v

def new_patient(c):
    r = c.post("/api/patients", json={"ward_id": 1, "name": "T", "admission_date": "2026-11-14"})
    return r.get_json()["patient_id"]

def test_stable_is_low(c):
    pid = new_patient(c)
    r = c.post("/api/vitals", json={"patient_id": pid, **vit()}).get_json()
    assert r["total_score"] == 0 and r["risk_tier"] == "Low" and not r["alert_raised"]

def test_critical_raises_emergency_once(c):
    pid = new_patient(c)
    crit = vit(respiration_rate=28, spo2=89, supplemental_o2=1, systolic_bp=88, pulse=135, consciousness="Confusion", temperature=39.4)
    a = c.post("/api/vitals", json={"patient_id": pid, **crit}).get_json()
    b = c.post("/api/vitals", json={"patient_id": pid, **crit}).get_json()
    assert a["risk_tier"] == "High" and a["alert_raised"] and a["alert_level"] == "Emergency"
    assert not b["alert_raised"]                      # no duplicate alert

def test_worsening_trend_warning(c):
    pid = new_patient(c)
    c.post("/api/vitals", json={"patient_id": pid, **vit()})
    c.post("/api/vitals", json={"patient_id": pid, **vit(pulse=95, respiration_rate=22)})
    r = c.post("/api/vitals", json={"patient_id": pid, **vit(pulse=115, respiration_rate=22, temperature=38.5)}).get_json()
    assert r["alert_level"] == "Warning" and r["alert_type"] == "worsening_trend"

def test_acknowledge_and_resolve(c):
    pid = new_patient(c)
    crit = vit(respiration_rate=28, spo2=89, supplemental_o2=1, systolic_bp=88, pulse=135, consciousness="Confusion")
    c.post("/api/vitals", json={"patient_id": pid, **crit})
    assert c.patch(f"/api/patients/{pid}/acknowledge", json={}).status_code == 200
    row = [p for p in c.get("/api/alerts").get_json() if p["patient_id"] == pid][0]
    assert row["alert_acknowledged"] and "Nurse Demo" in row["acknowledged_by"]
    c.patch(f"/api/patients/{pid}/resolve")
    assert all(p["patient_id"] != pid for p in c.get("/api/alerts").get_json())

def test_validation_and_404(c):
    pid = new_patient(c)
    assert c.post("/api/vitals", json={"patient_id": pid, **vit(spo2=250)}).status_code == 400
    assert c.post("/api/vitals", json={"patient_id": 99999, **vit()}).status_code == 404

def test_history_is_patient_attribute(c):
    pid = new_patient(c)
    c.post("/api/vitals", json={"patient_id": pid, **vit()})
    c.post("/api/vitals", json={"patient_id": pid, **vit(pulse=100)})
    h = c.get(f"/api/patients/{pid}/history").get_json()
    assert len(h) == 2 and "total_score" in h[0]


# ---------------- multi-hospital + alert audience ----------------
def _mk_hospital(admin, name, wards):
    r = admin.post("/api/hospitals", json={"name": name, "address": "Test", "wards": wards})
    assert r.status_code == 201, r.get_json()
    return r.get_json()["hospital_id"]

def _mk_staff(admin, username, role, hospital_id):
    r = admin.post("/api/staff", json={"username": username, "full_name": username.title(), "role": role,
                                       "password": os.getenv("INITIAL_PASSWORD", "ChangeMe123!"), "hospital_id": hospital_id})
    assert r.status_code in (201, 400), r.get_json()

def test_hospitals_are_isolated_and_admin_gets_no_alerts():
    admin = Client("admin")
    import uuid; tag = uuid.uuid4().hex[:6]
    h2 = _mk_hospital(admin, f"Second Hospital {tag}", ["Ward X", "Ward Y"])
    ward = admin.get("/api/wards").get_json()
    w2 = next(w for w in ward if w["hospital_id"] == h2)["ward_id"]
    _mk_staff(admin, f"nurse2{tag}", "Nurse", h2)
    n2, n1 = Client(f"nurse2{tag}"), Client("nurse")

    # a nurse can only admit into her own hospital
    assert n1.post("/api/patients", json={"ward_id": w2, "name": "X", "admission_date": "2026-11-14"}).status_code == 400
    pid = n2.post("/api/patients", json={"ward_id": w2, "name": "H2 Patient", "admission_date": "2026-11-14"}).get_json()["patient_id"]

    # hospital 1 staff cannot see, read or chart hospital 2's patient
    assert pid not in [p["patient_id"] for p in n1.get("/api/dashboard").get_json()]
    assert n1.get(f"/api/patients/{pid}/history").status_code == 404
    assert n1.post("/api/vitals", json={"patient_id": pid, **vit()}).status_code == 404
    assert n1.patch(f"/api/patients/{pid}/acknowledge").status_code == 404

    # critical reading -> emergency for hospital 2's nurse, invisible to hospital 1, never reaches Admin
    n2.post("/api/vitals", json={"patient_id": pid, **vit(respiration_rate=28, spo2=89, supplemental_o2=1, systolic_bp=88, pulse=135, consciousness="Confusion", temperature=39.4)})
    mine = [p for p in n2.get("/api/alerts").get_json() if p["patient_id"] == pid]
    assert mine and mine[0]["alert_level"] == "Emergency"
    assert all(p["patient_id"] != pid for p in n1.get("/api/alerts").get_json())
    assert admin.get("/api/alerts").status_code == 403
    assert admin.patch(f"/api/patients/{pid}/acknowledge").status_code == 403
    seen = [p for p in admin.get("/api/dashboard").get_json() if p["patient_id"] == pid][0]
    assert seen["alert_level"] == "None" and seen["escalated"] is False
    # admin can filter to one hospital
    only = admin.get(f"/api/dashboard?hospital_id={h2}").get_json()
    assert {p["hospital_id"] for p in only} == {h2}

def test_hospital_and_ward_rules():
    admin = Client("admin")
    import uuid; tag = uuid.uuid4().hex[:6]
    h = _mk_hospital(admin, f"Rules Hospital {tag}", ["A"])
    assert admin.post("/api/hospitals", json={"name": f"rules hospital {tag}"}).status_code == 400      # duplicate name
    assert admin.post(f"/api/hospitals/{h}/wards", json={"name": "a"}).status_code == 400               # duplicate ward
    assert admin.post(f"/api/hospitals/{h}/wards", json={"name": "B"}).status_code == 201
    assert Client("nurse").post("/api/hospitals", json={"name": "Nope"}).status_code == 403
    assert admin.post("/api/staff", json={"username": f"nohosp{tag}", "full_name": "N", "role": "Doctor", "password": "ChangeMe123!"}).status_code == 400
    assert admin.delete(f"/api/hospitals/{h}").status_code == 200                                         # empty -> removable

def test_live_events_respect_hospital_and_role():
    import events
    nurse1, nurse2, admin = events.subscribe(1, True), events.subscribe(2, True), events.subscribe(None, False)
    try:
        events.publish({"type": "reading", "hospital_id": 1, "patient_id": 9, "total_score": 12, "alert_raised": True, "alert_level": "Emergency", "alert_type": "threshold_breach"})
        events.publish({"type": "ack", "hospital_id": 1, "patient_id": 9})
        assert nurse2.empty()                                            # other hospital: nothing
        first = nurse1.get_nowait(); assert first["alert_level"] == "Emergency"
        assert nurse1.get_nowait()["type"] == "ack"
        got = admin.get_nowait()                                         # admin: reading yes, alert fields no
        assert got["type"] == "reading" and "alert_level" not in got and "alert_raised" not in got
        assert admin.empty()                                             # admin never sees ack/resolve
    finally:
        for q in (nurse1, nurse2, admin): events.unsubscribe(q)
