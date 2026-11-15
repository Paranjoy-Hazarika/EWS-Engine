"""Bedside-monitor simulator: sends a new reading for each simulated patient every few seconds,
through the same record_reading() path the nurse form uses, so alerts/alarms behave identically."""
import random, threading, time
from dbutil import tx, patient_hospital
from scoring import record_reading
import events

STABLE   = dict(respiration_rate=16, spo2=98, supplemental_o2=0, systolic_bp=125, pulse=76, consciousness="Alert", temperature=36.8)
MILD     = dict(respiration_rate=22, spo2=94, supplemental_o2=0, systolic_bp=108, pulse=98, consciousness="Alert", temperature=37.9)
WORSE    = dict(respiration_rate=24, spo2=92, supplemental_o2=1, systolic_bp=98,  pulse=112, consciousness="Alert", temperature=38.6)
CRITICAL = dict(respiration_rate=28, spo2=89, supplemental_o2=1, systolic_bp=88,  pulse=135, consciousness="Confusion", temperature=39.4)

# Every patient is treated the same way: after each "episode" ends, the next one is chosen at random
# (mostly stable, sometimes mild, rarely deteriorating), and only ONE patient may deteriorate at a time.
EPISODE_WEIGHTS = [("stable", 6), ("mild", 3), ("deteriorating", 1)]

_state = {"running": False, "interval": 5, "ticks": 0, "thread": None}
_runs = {}   # patient_id -> {"script": [...], "i": position, "det": bool}


def _script(kind):
    if kind == "stable":
        return [STABLE] * random.randint(5, 9)
    if kind == "mild":
        return random.choice([[STABLE, MILD, MILD, STABLE, STABLE], [MILD, MILD, STABLE, STABLE, STABLE, STABLE]])
    return [STABLE, MILD, WORSE, CRITICAL, CRITICAL, WORSE, MILD, STABLE]


def _jitter(base, pid):
    """Small random change, plus a fixed personal baseline so patients do not look identical."""
    off = random.Random(pid).randint(-6, 6)
    v = dict(base)
    v["respiration_rate"] += random.choice([-1, 0, 0, 1])
    v["pulse"] += random.choice([-2, -1, 0, 1, 2]) + (off if base is STABLE else 0)
    v["systolic_bp"] += (off * 2 if base is STABLE else 0)
    v["spo2"] = min(100, v["spo2"] + random.choice([0, 0, 1]))
    return v


def _next_reading(pid):
    run = _runs.get(pid)
    if not run or run["i"] >= len(run["script"]):
        busy = any(r["det"] and r["i"] < len(r["script"]) for q, r in _runs.items() if q != pid)
        kind = random.choices([k for k, _ in EPISODE_WEIGHTS], [w for _, w in EPISODE_WEIGHTS])[0]
        if kind == "deteriorating" and busy:
            kind = "mild"
        run = _runs[pid] = {"script": _script(kind), "i": 0, "det": kind == "deteriorating"}
    v = run["script"][run["i"]]
    run["i"] += 1
    return v


def _tick():
    with tx() as cur:
        cur.execute("SELECT patient_id FROM PATIENT ORDER BY patient_id")
        ids = [r["patient_id"] for r in cur.fetchall()]
    if ids and not _runs:    # first round: one RANDOM patient starts deteriorating so the demo has an alarm soon
        star = random.choice(ids)
        for pid in ids:
            if pid == star:
                _runs[pid] = {"script": _script("deteriorating"), "i": 0, "det": True}
            else:
                _runs[pid] = {"script": _script("stable"), "i": random.randint(0, 3), "det": False}
    for pid in ids:
        with tx() as cur:
            res = record_reading(cur, pid, _jitter(_next_reading(pid), pid))
            hid = patient_hospital(cur, pid)
        events.publish({"type": "reading", "hospital_id": hid, **{k: res[k] for k in ("patient_id", "name", "total_score", "risk_tier", "alert_raised", "alert_level", "alert_type")}})
    _state["ticks"] += 1


def _loop():
    while _state["running"]:
        try:
            _tick()
        except Exception as e:      # keep the demo alive if one tick fails
            print("simulator error:", e)
        for _ in range(int(_state["interval"] * 10)):
            if not _state["running"]:
                return
            time.sleep(0.1)


def start(interval=5):
    if _state["running"]:
        return status()
    _runs.clear()
    _state.update(running=True, interval=max(1, min(60, float(interval))), ticks=0)
    t = threading.Thread(target=_loop, daemon=True)
    _state["thread"] = t
    t.start()
    return status()


def stop():
    _state["running"] = False
    return status()


def status():
    return {"running": _state["running"], "interval": _state["interval"], "ticks": _state["ticks"]}
