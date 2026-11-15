-- EWS Engine: final database design (5 tables).
-- As suggested by the supervisor, vital readings and alerts are NOT separate tables:
-- they are attributes of PATIENT (latest observation, derived score, alert state, and the
-- reading history as a JSON list, i.e. a multivalued composite attribute).
CREATE DATABASE IF NOT EXISTS ews_engine;
USE ews_engine;

CREATE TABLE HOSPITAL (
    hospital_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    address VARCHAR(200)
);

CREATE TABLE WARD (
    ward_id INT AUTO_INCREMENT PRIMARY KEY,
    hospital_id INT NOT NULL,
    name VARCHAR(80) NOT NULL,
    FOREIGN KEY (hospital_id) REFERENCES HOSPITAL(hospital_id)
);

CREATE TABLE VITAL_PARAMETER (
    parameter_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(60) NOT NULL UNIQUE,
    unit VARCHAR(20)
);

CREATE TABLE SCORING_RULE (
    rule_id INT AUTO_INCREMENT PRIMARY KEY,
    parameter_id INT NOT NULL,
    range_min DECIMAL(6,2) NOT NULL,
    range_max DECIMAL(6,2) NOT NULL,
    score INT NOT NULL,
    FOREIGN KEY (parameter_id) REFERENCES VITAL_PARAMETER(parameter_id)
);

CREATE TABLE PATIENT (
    patient_id INT AUTO_INCREMENT PRIMARY KEY,
    ward_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    dob DATE,
    admission_date DATE NOT NULL,

    -- latest observation (attributes of the patient)
    last_recorded_at DATETIME NULL,
    respiration_rate INT NULL,
    spo2 INT NULL,
    supplemental_o2 BOOLEAN NULL,
    systolic_bp INT NULL,
    pulse INT NULL,
    consciousness ENUM('Alert','Confusion','Voice','Pain','Unresponsive') NULL,
    temperature DECIMAL(4,1) NULL,

    -- derived from the latest observation
    total_score INT NULL,
    risk_tier ENUM('Low','Medium','High') NULL,

    -- alert state (attributes of the patient)
    alert_level ENUM('None','Warning','Emergency') NOT NULL DEFAULT 'None',
    alert_type ENUM('none','worsening_trend','threshold_breach') NOT NULL DEFAULT 'none',
    alert_since DATETIME NULL,
    alert_acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
    acknowledged_by VARCHAR(60) NULL,
    acknowledged_at DATETIME NULL,

    -- full reading history: multivalued composite attribute stored as a JSON list
    readings JSON NULL,

    FOREIGN KEY (ward_id) REFERENCES WARD(ward_id)
);

-- Authentication only (not part of the clinical model): staff who may sign in.
CREATE TABLE STAFF (
    staff_id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(40) NOT NULL UNIQUE,
    full_name VARCHAR(80) NOT NULL,
    role ENUM('Doctor','Nurse','Admin') NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    -- doctors and nurses work at one hospital and only see (and get alerts for) that hospital; Admin has none
    hospital_id INT NULL,
    FOREIGN KEY (hospital_id) REFERENCES HOSPITAL(hospital_id)
);
