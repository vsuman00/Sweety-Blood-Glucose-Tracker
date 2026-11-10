ALTER TABLE users ADD COLUMN role text NOT NULL DEFAULT 'patient'
  CHECK (role IN ('patient','doctor'));
CREATE TABLE doctor_patients (
  doctor_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  patient_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (doctor_id,patient_id),
  CHECK (doctor_id <> patient_id)
);
CREATE INDEX doctor_patients_patient_idx ON doctor_patients(patient_id);
