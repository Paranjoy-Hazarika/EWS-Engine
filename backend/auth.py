"""Staff authentication: password hashing, signed expiring tokens, role checks, login lockout."""
import os, time
from functools import wraps
from flask import request, jsonify, g
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from werkzeug.security import generate_password_hash, check_password_hash
from dbutil import tx
import migrate

PRODUCTION = os.getenv("APP_ENV") == "production"
SECRET = os.getenv("SECRET_KEY", "")
if PRODUCTION and len(SECRET) < 16:
    raise RuntimeError("Set SECRET_KEY (16+ random characters) before running in production.")
SECRET = SECRET or "dev-only-insecure-key"
TOKEN_HOURS = int(os.getenv("TOKEN_HOURS", "12"))
ROLES = ("Doctor", "Nurse", "Admin")
ALERT_ROLES = ("Doctor", "Nurse")      # only clinical staff receive alerts and alarms; Admin never does
_ser = URLSafeTimedSerializer(SECRET, salt="ews-auth")
_fails = {}   # username -> (count, first_failure_time)


def make_token(staff_id):
    return _ser.dumps(staff_id)


def current_user():
    h = request.headers.get("Authorization", "")
    tok = h[7:] if h.startswith("Bearer ") else request.args.get("token")   # EventSource cannot send headers
    if not tok:
        return None
    try:
        sid = _ser.loads(tok, max_age=TOKEN_HOURS * 3600)
    except (BadSignature, SignatureExpired):
        return None
    with tx() as cur:
        cur.execute("SELECT s.staff_id, s.username, s.full_name, s.role, s.hospital_id, h.name AS hospital_name "
                    "FROM STAFF s LEFT JOIN HOSPITAL h ON h.hospital_id = s.hospital_id "
                    "WHERE s.staff_id=%s AND s.active=1", (sid,))
        return cur.fetchone()


def require(*roles):
    """Route decorator: must be signed in, and (if roles given) have one of them."""
    def deco(f):
        @wraps(f)
        def wrapper(*a, **k):
            u = current_user()
            if not u:
                return jsonify({"error": "Please sign in"}), 401
            if roles and u["role"] not in roles:
                return jsonify({"error": "Your role is not allowed to do this"}), 403
            g.user = u
            return f(*a, **k)
        return wrapper
    return deco


def check_lock(username):
    n, t = _fails.get(username, (0, 0))
    if n >= 5 and time.time() - t < 300:
        return True
    if time.time() - t >= 300:
        _fails.pop(username, None)
    return False


def note_failure(username):
    n, t = _fails.get(username, (0, time.time()))
    _fails[username] = (n + 1, t)


def clear_failures(username):
    _fails.pop(username, None)


def hash_password(pw):
    return generate_password_hash(pw)


def verify_password(h, pw):
    return check_password_hash(h, pw)


def ensure_default_staff():
    """First start: create one account per role so the system can be signed into."""
    pw = os.getenv("INITIAL_PASSWORD", "ChangeMe123!")
    for attempt in range(15):                       # database may still be starting
        try:
            migrate.ensure_schema()                 # upgrades an older database in place (no manual SQL needed)
            with tx() as cur:
                cur.execute("SELECT COUNT(*) AS n FROM STAFF")
                if cur.fetchone()["n"]:
                    return
                cur.execute("SELECT MIN(hospital_id) AS h FROM HOSPITAL")
                first = cur.fetchone()["h"]
                for u, n, r in [("admin", "System Admin", "Admin"), ("doctor", "Dr. Demo", "Doctor"), ("nurse", "Nurse Demo", "Nurse")]:
                    cur.execute("INSERT INTO STAFF (username, full_name, role, password_hash, hospital_id) VALUES (%s,%s,%s,%s,%s)",
                                (u, n, r, hash_password(pw), None if r == "Admin" else first))
            return
        except Exception as e:
            print("waiting for database:", e)
            time.sleep(2)
