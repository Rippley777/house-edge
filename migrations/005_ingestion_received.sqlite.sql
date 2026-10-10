-- Apply after migration 004. Historical receive time is unknown.
BEGIN IMMEDIATE;
ALTER TABLE events ADD COLUMN received_at VARCHAR(24) NULL;
INSERT INTO schema_migrations (version, applied_at) SELECT 5, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = 5);
COMMIT;
