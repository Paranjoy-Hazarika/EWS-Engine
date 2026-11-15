"""Transaction helper and JSON formatting shared by the routes and the simulator."""
from contextlib import contextmanager
from datetime import datetime, date
from decimal import Decimal
from flask.json.provider import DefaultJSONProvider
from db import get_connection

@contextmanager
def tx():
    """One transaction: commit on success, roll back on any error."""
    conn = get_connection()
    cur = conn.cursor(dictionary=True)
    try:
        yield cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()

class JsonProvider(DefaultJSONProvider):
    @staticmethod
    def default(o):
        if isinstance(o, datetime):
            return o.strftime("%Y-%m-%dT%H:%M:%SZ")
        if isinstance(o, date):
            return o.isoformat()
        if isinstance(o, Decimal):
            return float(o)
        return DefaultJSONProvider.default(o)


def patient_hospital(cur, patient_id):
    """hospital_id that a patient belongs to (through the ward), or None if there is no such patient."""
    cur.execute("SELECT w.hospital_id FROM PATIENT p JOIN WARD w ON w.ward_id = p.ward_id WHERE p.patient_id = %s", (patient_id,))
    row = cur.fetchone()
    return row["hospital_id"] if row else None
