-- App-generated delivery challans: one challan covers several cases of ONE doctor
CREATE SEQUENCE IF NOT EXISTS delivery_challan_seq START 1;

CREATE TABLE IF NOT EXISTS delivery_challans (
  id           SERIAL PRIMARY KEY,
  challan_no   INT  UNIQUE NOT NULL DEFAULT nextval('delivery_challan_seq'),
  challan_date DATE NOT NULL,
  doctor_id    INT  NOT NULL REFERENCES doctors(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_challans_date   ON delivery_challans (challan_date);
CREATE INDEX IF NOT EXISTS idx_challans_doctor ON delivery_challans (doctor_id);

-- Cancelling (deleting) a challan releases its cases
ALTER TABLE cases ADD COLUMN IF NOT EXISTS delivery_challan_id INT REFERENCES delivery_challans(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_cases_challan ON cases (delivery_challan_id);

-- Retire the hand-typed columns from migration 004; keep anything typed in them by moving it into notes
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'cases' AND column_name = 'delivery_challan_no') THEN
    EXECUTE $q$UPDATE cases
                SET notes = concat_ws(E'\n', notes,
                      'Delivery challan (typed): ' || concat_ws(' ', delivery_challan_no, delivery_challan_date::text))
                WHERE delivery_challan_no IS NOT NULL OR delivery_challan_date IS NOT NULL$q$;
    ALTER TABLE cases DROP COLUMN delivery_challan_no, DROP COLUMN delivery_challan_date;
  END IF;
END $$;
