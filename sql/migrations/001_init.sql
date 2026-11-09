CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','viewer'))
);

CREATE TABLE IF NOT EXISTS doctors (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  clinic TEXT,
  phone TEXT
);

CREATE TABLE IF NOT EXISTS work_types (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  default_rate NUMERIC(10,2) NOT NULL DEFAULT 0
);

CREATE SEQUENCE IF NOT EXISTS challan_seq START 1;

CREATE TABLE IF NOT EXISTS cases (
  id SERIAL PRIMARY KEY,
  case_date DATE NOT NULL DEFAULT CURRENT_DATE,
  model_no TEXT,
  teeth_no TEXT,
  work_type_id INT REFERENCES work_types(id),
  doctor_id INT NOT NULL REFERENCES doctors(id),
  patient_name TEXT NOT NULL,
  challan_no INT UNIQUE NOT NULL DEFAULT nextval('challan_seq'),
  delivery_date DATE,
  qty INT NOT NULL DEFAULT 1,
  rate NUMERIC(10,2) NOT NULL,
  total NUMERIC(10,2) GENERATED ALWAYS AS (qty * rate) STORED,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_cases_date ON cases (case_date);
CREATE INDEX IF NOT EXISTS idx_cases_doctor_date ON cases (doctor_id, case_date);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  doctor_id INT NOT NULL REFERENCES doctors(id),
  paid_on DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC(10,2) NOT NULL,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_payments_doctor_date ON payments (doctor_id, paid_on);

CREATE TABLE IF NOT EXISTS "session" (
  sid VARCHAR PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_expire ON "session" (expire);
