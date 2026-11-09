-- Teeth are stored by quadrant: {"UR":[1,2],"UL":[3],"LR":[],"LL":[8]}
ALTER TABLE cases ADD COLUMN IF NOT EXISTS teeth JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE cases DROP CONSTRAINT IF EXISTS cases_teeth_is_object;
ALTER TABLE cases ADD CONSTRAINT cases_teeth_is_object CHECK (jsonb_typeof(teeth) = 'object');

-- Retire the old free-text column; keep any existing text by moving it into notes
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'cases' AND column_name = 'teeth_no') THEN
    EXECUTE $q$UPDATE cases
                SET notes = concat_ws(E'\n', notes, 'Teeth: ' || teeth_no)
                WHERE COALESCE(teeth_no, '') <> ''$q$;
    ALTER TABLE cases DROP COLUMN teeth_no;
  END IF;
END $$;
