CREATE TABLE IF NOT EXISTS projects (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  folder_path  TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  thumbnail    TEXT,
  metadata     TEXT
);

CREATE TABLE IF NOT EXISTS shots (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES projects(id),
  shot_number      TEXT NOT NULL,
  parent_shot_id   TEXT,
  act              INTEGER,
  scene            INTEGER,
  shot_type        TEXT,
  camera_angle     TEXT,
  duration_s       INTEGER,
  tension_level    INTEGER,
  chain_status     TEXT,
  prev_shot_id     TEXT,
  prompt_start     TEXT,
  prompt_end       TEXT,
  prompt_video     TEXT,
  summary_tr       TEXT,
  model            TEXT,
  cfg              REAL,
  kling_preset     TEXT,
  transition_mode  TEXT,
  image_start_path TEXT,
  image_end_path   TEXT,
  video_path       TEXT,
  video_4k_path    TEXT,
  image_status     TEXT DEFAULT 'pending',
  video_status     TEXT DEFAULT 'pending',
  upscale_status   TEXT DEFAULT 'none',
  source_file      TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id),
  type        TEXT NOT NULL,
  file_path   TEXT NOT NULL,
  filename    TEXT NOT NULL,
  width       INTEGER,
  height      INTEGER,
  duration_s  REAL,
  resolution  TEXT,
  model_used  TEXT,
  prompt      TEXT,
  cost_usd    REAL,
  fal_job_id  TEXT,
  shot_id     TEXT,
  tags        TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS characters (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES projects(id),
  name             TEXT NOT NULL,
  description      TEXT,
  kling_element_id TEXT,
  ref_images       TEXT,
  primary_image    TEXT,
  style_notes      TEXT,
  created_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS job_queue (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL,
  type             TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'queued',
  priority         INTEGER DEFAULT 0,
  shot_id          TEXT,
  asset_id         TEXT,
  model            TEXT,
  prompt           TEXT,
  params           TEXT,
  ref_image_path   TEXT,
  fal_job_id       TEXT,
  tensorpix_job_id TEXT,
  progress         REAL DEFAULT 0,
  error_msg        TEXT,
  cost_usd         REAL,
  result_path      TEXT,
  queued_at        INTEGER NOT NULL,
  started_at       INTEGER,
  completed_at     INTEGER,
  sequence_order   INTEGER
);

CREATE TABLE IF NOT EXISTS cost_logs (
  id         TEXT PRIMARY KEY,
  project_id TEXT,
  job_id     TEXT,
  model      TEXT NOT NULL,
  type       TEXT NOT NULL,
  amount_usd REAL NOT NULL,
  units      REAL,
  logged_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_templates (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  category   TEXT,
  content    TEXT NOT NULL,
  model      TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS model_presets (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  image_model  TEXT,
  video_model  TEXT,
  image_params TEXT,
  video_params TEXT,
  is_default   INTEGER DEFAULT 0,
  created_at   INTEGER NOT NULL
);
