CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expiry ON auth_sessions(expires_at);
CREATE TABLE IF NOT EXISTS sync_records (
  id text PRIMARY KEY,
  owner uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  logical_key text NOT NULL,
  document jsonb NOT NULL,
  UNIQUE(owner, logical_key)
);
CREATE INDEX IF NOT EXISTS sync_records_owner_id ON sync_records(owner,id);
CREATE TABLE IF NOT EXISTS sync_mutations (
  id text PRIMARY KEY,
  owner uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS sync_mutations_owner ON sync_mutations(owner);
