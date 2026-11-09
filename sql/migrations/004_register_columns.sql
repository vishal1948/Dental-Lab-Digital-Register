-- The auto number is the register's "Sr. No."; rename so it can't be confused with the delivery challan
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'cases' AND column_name = 'challan_no') THEN
    ALTER TABLE cases RENAME COLUMN challan_no TO sr_no;
  END IF;
END $$;
ALTER SEQUENCE IF EXISTS challan_seq RENAME TO sr_seq;

-- Paper register column "Delivery Challan No. / Date" (filled in when the work goes out)
ALTER TABLE cases ADD COLUMN IF NOT EXISTS delivery_challan_no   TEXT;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS delivery_challan_date DATE;
