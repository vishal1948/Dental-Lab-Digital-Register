-- Monthly invoices per doctor. Amounts are a snapshot taken at issue time.
CREATE SEQUENCE IF NOT EXISTS invoice_seq START 1;

CREATE TABLE IF NOT EXISTS invoices (
  id               SERIAL PRIMARY KEY,
  invoice_no       INT  UNIQUE NOT NULL DEFAULT nextval('invoice_seq'),
  doctor_id        INT  NOT NULL REFERENCES doctors(id),
  period_month     DATE NOT NULL CHECK (EXTRACT(DAY FROM period_month) = 1),
  invoice_date     DATE NOT NULL,
  previous_balance NUMERIC(12,2) NOT NULL,
  bill_total       NUMERIC(12,2) NOT NULL,
  payments_total   NUMERIC(12,2) NOT NULL,
  payment_count    INT NOT NULL DEFAULT 0,
  total_balance    NUMERIC(12,2) NOT NULL,
  case_count       INT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (doctor_id, period_month)
);
CREATE INDEX IF NOT EXISTS idx_invoices_period ON invoices (period_month);

-- Cancelling (deleting) an invoice releases its cases
ALTER TABLE cases ADD COLUMN IF NOT EXISTS invoice_id INT REFERENCES invoices(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_cases_invoice ON cases (invoice_id);

-- A payment must be a positive amount
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_amount_positive;
ALTER TABLE payments ADD CONSTRAINT payments_amount_positive CHECK (amount > 0);
