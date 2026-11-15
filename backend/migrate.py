"""Automatic, safe schema upgrade so an existing database keeps working after the multi-hospital update.

Adds STAFF.hospital_id (which hospital a doctor or nurse works at). Existing doctors and nurses are
assigned to the first hospital, so nothing stops working. Running this twice does nothing."""
from dbutil import tx


def ensure_schema():
    with tx() as cur:
        cur.execute("SELECT COUNT(*) AS n FROM information_schema.COLUMNS "
                    "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'STAFF' AND COLUMN_NAME = 'hospital_id'")
        if cur.fetchone()["n"]:
            return
        cur.execute("ALTER TABLE STAFF ADD COLUMN hospital_id INT NULL")
        cur.execute("ALTER TABLE STAFF ADD CONSTRAINT fk_staff_hospital FOREIGN KEY (hospital_id) REFERENCES HOSPITAL(hospital_id)")
        cur.execute("UPDATE STAFF SET hospital_id = (SELECT MIN(hospital_id) FROM HOSPITAL) WHERE role IN ('Doctor','Nurse')")
