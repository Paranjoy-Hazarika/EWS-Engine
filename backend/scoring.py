"""
EWS scoring and alert logic.

Design (supervisor's suggestion): vital readings and alerts are ATTRIBUTES OF PATIENT.
  * latest observation + derived score/tier  -> PATIENT columns
  * alert state (level, type, since, acknowledgement) -> PATIENT columns
  * full reading history -> JSON list in PATIENT.readings (multivalued composite attribute)
Clinical thresholds still live in SCORING_RULE (rules are data, not code).
"""
import json
from datetime import datetime

ACVPU = ["Alert", "Confusion", "Voice", "Pain", "Unresponsive"]
ACVPU_ORDINAL = {n: i for i, n in enumerate(ACVPU)}

VITALS = [
    ("respiration_rate", 1, "numeric"), ("spo2", 2, "numeric"),
    ("supplemental_o2", 3, "boolean"), ("systolic_bp", 4, "numeric"),
    ("pulse", 5, "numeric"), ("consciousness", 6, "categorical"),
    ("temperature", 7, "numeric"),
]
LIMITS = {"respiration_rate": (0, 80), "spo2": (0, 100), "systolic_bp": (30, 300),
          "pulse": (0, 300), "temperature": (25.0, 45.0)}
RANK = {"None": 0, "Warning": 1, "Emergency": 2}
MAX_HISTORY = 1000
DT_FORMAT = "%Y-%m-%d %H:%M:%S"


def now_str():
    return datetime.now().strftime(DT_FORMAT)


def validate(raw):
    clean = {}
    for field, _, kind in VITALS:
        v = raw.get(field)
        if v is None or v == "":
            raise ValueError(f"Missing required field: {field}")
        if kind == "numeric":
            try:
                v = float(v)
            except (TypeError, ValueError):
                raise ValueError(f"{field} must be a number")
            lo, hi = LIMITS[field]
            if not lo <= v <= hi:
                raise ValueError(f"{field} = {v:g} is outside the plausible range {lo} to {hi}")
            v = round(v, 1) if field == "temperature" else int(round(v))
        elif kind == "boolean":
            v = 1 if (v is True or str(v).lower() in ("1", "true", "yes")) else 0
        elif v not in ACVPU_ORDINAL:
            raise ValueError("consciousness must be one of: " + ", ".join(ACVPU))
        clean[field] = v
    return clean


def _score_for_parameter(cur, parameter_id, value):
    cur.execute(
        "SELECT score FROM SCORING_RULE WHERE parameter_id = %s AND %s BETWEEN range_min AND range_max "
        "ORDER BY rule_id LIMIT 1", (parameter_id, value))
    row = cur.fetchone()
    if row is None:
        raise ValueError(f"No scoring band matches parameter {parameter_id} value {value}")
    return int(row["score"])


def score_vitals(cur, vitals):
    total, highest, points = 0, 0, {}
    for field, pid, kind in VITALS:
        value = ACVPU_ORDINAL[vitals[field]] if kind == "categorical" else vitals[field]
        pts = _score_for_parameter(cur, pid, value)
        points[field] = pts
        total += pts
        highest = max(highest, pts)
    return total, highest, points


def classify(total, highest):
    """7+ High, 5-6 Medium, else Low; one vital scoring 3 lifts Low to Medium."""
    tier = "High" if total >= 7 else "Medium" if total >= 5 else "Low"
    if highest >= 3 and tier == "Low":
        tier = "Medium"
    return tier


def desired_alert(scores, tier):
    if tier == "High":
        return "Emergency", "threshold_breach"
    if len(scores) >= 2 and all(scores[i] < scores[i + 1] for i in range(len(scores) - 1)):
        return "Warning", "worsening_trend"
    return "None", "none"


def load_history(raw):
    if raw is None:
        return []
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8")
    return json.loads(raw) if isinstance(raw, str) else list(raw)


def record_reading(cur, patient_id, raw, recorded_at=None):
    """Score one observation, update alert state, append to history (inside caller's transaction).
    The patient row is locked FOR UPDATE so an alert can never be raised twice."""
    cur.execute("SELECT * FROM PATIENT WHERE patient_id = %s FOR UPDATE", (patient_id,))
    patient = cur.fetchone()
    if patient is None:
        raise LookupError("Patient not found")

    vitals = validate(raw)
    total, highest, points = score_vitals(cur, vitals)
    tier = classify(total, highest)
    when = recorded_at or now_str()

    history = load_history(patient["readings"])
    history.append({"recorded_at": when, **vitals, "total_score": total, "risk_tier": tier})
    history = history[-MAX_HISTORY:]

    level, atype = desired_alert([h["total_score"] for h in history[-3:]], tier)
    raised = RANK[level] > RANK[patient["alert_level"]]

    sets = {"last_recorded_at": when, **vitals, "total_score": total, "risk_tier": tier,
            "readings": json.dumps(history)}
    if raised:
        sets.update(alert_level=level, alert_type=atype, alert_since=now_str(),
                    alert_acknowledged=0, acknowledged_by=None, acknowledged_at=None)
    assignments = ", ".join(f"{k} = %s" for k in sets)
    cur.execute(f"UPDATE PATIENT SET {assignments} WHERE patient_id = %s", (*sets.values(), patient_id))

    return {"patient_id": patient_id, "name": patient["name"], "recorded_at": when,
            "total_score": total, "risk_tier": tier, "points": points,
            "alert_level": level if raised else patient["alert_level"],
            "alert_type": atype if raised else patient["alert_type"],
            "alert_raised": raised}
