USE ews_engine;

-- Vital parameters (ids 1-7 are used by the scoring code)
INSERT INTO VITAL_PARAMETER (name, unit) VALUES
('Respiration Rate', 'breaths/min'),
('SpO2', '%'),
('Supplemental O2', 'boolean'),
('Systolic BP', 'mmHg'),
('Pulse', 'bpm'),
('Consciousness', 'ACVPU'),
('Temperature', 'C');

-- Scoring bands: (parameter_id, range_min, range_max, score). -999 / 999 mean "no limit".
INSERT INTO SCORING_RULE (parameter_id, range_min, range_max, score) VALUES
(1, -999, 8, 3), (1, 9, 11, 1), (1, 12, 20, 0), (1, 21, 24, 2), (1, 25, 999, 3),
(2, -999, 91, 3), (2, 92, 93, 2), (2, 94, 95, 1), (2, 96, 999, 0),
(3, 0, 0, 0), (3, 1, 1, 2),
(4, -999, 90, 3), (4, 91, 100, 2), (4, 101, 110, 1), (4, 111, 219, 0), (4, 220, 999, 3),
(5, -999, 40, 3), (5, 41, 50, 1), (5, 51, 90, 0), (5, 91, 110, 1), (5, 111, 130, 2), (5, 131, 999, 3),
-- Consciousness (ACVPU ordinal: 0 Alert, 1 Confusion, 2 Voice, 3 Pain, 4 Unresponsive)
(6, 0, 0, 0), (6, 1, 1, 3), (6, 2, 2, 3), (6, 3, 3, 3), (6, 4, 4, 3),
(7, -999, 35.0, 3), (7, 35.1, 36.0, 1), (7, 36.1, 38.0, 0), (7, 38.1, 39.0, 1), (7, 39.1, 999, 2);

INSERT INTO HOSPITAL (name, address) VALUES ('Tezpur District Hospital', 'Tezpur, Assam');
INSERT INTO WARD (hospital_id, name) VALUES (1, 'General Ward A'), (1, 'General Ward B'), (1, 'High Dependency Unit');

-- Patients start with no readings (history is an empty JSON list).
INSERT INTO PATIENT (ward_id, name, dob, admission_date, readings) VALUES
(1, 'Test Patient', '1975-04-12', CURDATE(), '[]'),
(1, 'Ravi Das',     '1980-05-14', CURDATE(), '[]'),
(1, 'Meena Borah',  '1989-09-03', CURDATE(), '[]'),
(2, 'Anil Gogoi',   '1962-12-20', CURDATE(), '[]');
