CREATE TABLE reminder_logs (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reading_date date NOT NULL,
  reading_count integer NOT NULL CHECK (reading_count BETWEEN 0 AND 3),
  logged_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,reading_date)
);
