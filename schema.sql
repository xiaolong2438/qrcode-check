CREATE TABLE IF NOT EXISTS inspection_records (
  id TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL,
  machine_name TEXT NOT NULL,
  record_date TEXT NOT NULL,
  operator_name TEXT NOT NULL,
  checks_json TEXT NOT NULL,
  overall_remark TEXT,
  form_opened_at TEXT,
  client_submitted_at TEXT,
  server_submitted_at TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_inspection_records_server_submitted_at
  ON inspection_records(server_submitted_at);

CREATE INDEX IF NOT EXISTS idx_inspection_records_record_date
  ON inspection_records(record_date);
