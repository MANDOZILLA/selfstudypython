CREATE TABLE learner_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  initialized INTEGER NOT NULL DEFAULT 0 CHECK (initialized IN (0,1)),
  legacy_imported INTEGER NOT NULL DEFAULT 0 CHECK (legacy_imported IN (0,1)),
  active_tab TEXT NOT NULL DEFAULT 'overview' CHECK (active_tab IN ('overview','lessons','learned','assessment','portfolio')),
  learning_mode INTEGER NOT NULL DEFAULT 1 CHECK (learning_mode IN (0,1))
);
INSERT INTO learner_meta(id) VALUES (1);
CREATE TABLE mission_runs (
  id TEXT PRIMARY KEY NOT NULL, mission_id TEXT NOT NULL, mission_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','paused','completed')),
  stage_index INTEGER NOT NULL CHECK (stage_index BETWEEN 0 AND 3), position INTEGER NOT NULL UNIQUE CHECK(position >= 0),
  payload TEXT NOT NULL CHECK(json_valid(payload))
);
CREATE UNIQUE INDEX one_open_run ON mission_runs((1)) WHERE status IN ('active','paused');
CREATE TABLE mission_stages (
  run_id TEXT NOT NULL REFERENCES mission_runs(id) ON DELETE CASCADE, stage_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 3),
  status TEXT NOT NULL CHECK(status IN ('pending','active','completed')),
  payload TEXT NOT NULL CHECK(json_valid(payload)), PRIMARY KEY(run_id,stage_id), UNIQUE(run_id,position)
);
CREATE TABLE mission_drafts (
  run_id TEXT NOT NULL REFERENCES mission_runs(id) ON DELETE CASCADE, task_id TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)), PRIMARY KEY(run_id,task_id)
);
CREATE TABLE attempts (
  id TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL, stage_id TEXT NOT NULL, task_id TEXT NOT NULL,
  position INTEGER NOT NULL UNIQUE CHECK(position >= 0), passed INTEGER NOT NULL CHECK(passed IN (0,1)),
  completed_at TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)),
  FOREIGN KEY(run_id,stage_id) REFERENCES mission_stages(run_id,stage_id) ON DELETE CASCADE
);
CREATE INDEX attempts_run_task ON attempts(run_id,task_id,position);
CREATE INDEX attempts_completed ON attempts(completed_at);
CREATE TABLE attempt_checks (
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE, position INTEGER NOT NULL CHECK(position >= 0),
  check_id TEXT NOT NULL, passed INTEGER NOT NULL CHECK(passed IN (0,1)), payload TEXT NOT NULL CHECK(json_valid(payload)),
  PRIMARY KEY(attempt_id,position), UNIQUE(attempt_id,check_id)
);
CREATE TABLE attempt_outcomes (
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE, position INTEGER NOT NULL CHECK(position >= 0),
  skill_id TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), PRIMARY KEY(attempt_id,position), UNIQUE(attempt_id,skill_id)
);
CREATE INDEX outcomes_skill ON attempt_outcomes(skill_id,attempt_id);
CREATE TABLE review_schedules (
  skill_id TEXT PRIMARY KEY NOT NULL, due_at TEXT NOT NULL,
  interval_days INTEGER NOT NULL CHECK(interval_days IN (1,3,7,14)), payload TEXT NOT NULL CHECK(json_valid(payload))
);
CREATE INDEX reviews_due ON review_schedules(due_at);
CREATE TABLE portfolio_snapshots (
  position INTEGER PRIMARY KEY CHECK(position >= 0), project_id TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload))
);
CREATE INDEX portfolio_project ON portfolio_snapshots(project_id);
CREATE TABLE diagnostic_sessions (
  id TEXT PRIMARY KEY NOT NULL, completed INTEGER NOT NULL CHECK(completed IN (0,1)), completed_at TEXT,
  profile_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(profile_json))
);
INSERT INTO diagnostic_sessions(id,completed) VALUES ('local',0);
CREATE TABLE diagnostic_responses (
  session_id TEXT NOT NULL REFERENCES diagnostic_sessions(id) ON DELETE CASCADE, question_id TEXT NOT NULL,
  response_json TEXT NOT NULL CHECK(json_valid(response_json)), PRIMARY KEY(session_id,question_id)
);
CREATE TABLE save_receipts (
  request_id TEXT PRIMARY KEY NOT NULL, payload_hash TEXT NOT NULL,
  revision INTEGER NOT NULL UNIQUE CHECK(revision > 0), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
