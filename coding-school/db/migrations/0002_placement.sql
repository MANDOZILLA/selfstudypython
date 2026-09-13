CREATE TABLE placement_sessions (
  id TEXT PRIMARY KEY,
  position INTEGER NOT NULL UNIQUE CHECK(position >= 0),
  status TEXT NOT NULL CHECK(status IN ('active','completed')),
  payload TEXT NOT NULL CHECK(json_valid(payload))
);
CREATE TABLE placement_drafts (
  session_id TEXT NOT NULL REFERENCES placement_sessions(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  PRIMARY KEY(session_id,item_id)
);
CREATE TABLE placement_attempts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES placement_sessions(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK(position >= 0),
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  UNIQUE(session_id,position)
);
CREATE INDEX placement_attempts_session ON placement_attempts(session_id,item_id);
CREATE TABLE placement_responses (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES placement_sessions(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  attempt_id TEXT REFERENCES placement_attempts(id),
  position INTEGER NOT NULL CHECK(position >= 0 AND position < 25),
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  UNIQUE(session_id,item_id),
  UNIQUE(session_id,position)
);
CREATE TABLE placement_profiles (
  session_id TEXT NOT NULL REFERENCES placement_sessions(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  PRIMARY KEY(session_id,skill_id)
);
