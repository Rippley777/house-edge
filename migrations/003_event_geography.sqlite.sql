-- Apply after migration 002. SQLite applies once; Azure DDL is idempotent.
BEGIN IMMEDIATE;
ALTER TABLE events ADD COLUMN event_environment VARCHAR(40) NULL;

UPDATE events SET event_environment = COALESCE(login_environment, (SELECT environment FROM projects WHERE projects.id = events.project_id)) WHERE event_environment IS NULL;

CREATE INDEX IF NOT EXISTS ix_event_geography_scope ON events (project_id, event_environment, event_name, timestamp);
INSERT INTO schema_migrations (version, applied_at) SELECT 3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = 3);
COMMIT;
