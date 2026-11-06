CREATE TABLE users (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 name text NOT NULL,
 email text NOT NULL UNIQUE,
 password_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE readings (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 reading_date date NOT NULL,
 slot text NOT NULL CHECK (slot IN ('morning_fasting','after_breakfast','after_lunch','after_dinner')),
 glucose_value integer NOT NULL CHECK (glucose_value BETWEEN 40 AND 600),
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT readings_user_date_slot_key UNIQUE(user_id, reading_date, slot)
);
CREATE TABLE sessions (sid varchar PRIMARY KEY, sess json NOT NULL, expire timestamp(6) NOT NULL);
CREATE INDEX sessions_expire_idx ON sessions(expire);
