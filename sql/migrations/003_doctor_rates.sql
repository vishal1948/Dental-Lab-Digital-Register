-- Per-doctor price overrides. No row = use work_types.default_rate.
CREATE TABLE IF NOT EXISTS doctor_rates (
  doctor_id    INT NOT NULL REFERENCES doctors(id)    ON DELETE CASCADE,
  work_type_id INT NOT NULL REFERENCES work_types(id) ON DELETE CASCADE,
  rate         NUMERIC(10,2) NOT NULL CHECK (rate >= 0),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (doctor_id, work_type_id)
);
CREATE INDEX IF NOT EXISTS idx_doctor_rates_work_type ON doctor_rates (work_type_id);
