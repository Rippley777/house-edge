-- Apply after migration 002. SQLite applies once; Azure DDL is idempotent.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.events', 'event_environment') IS NULL ALTER TABLE dbo.events ADD event_environment VARCHAR(40) NULL;
GO
UPDATE events SET event_environment = COALESCE(login_environment, (SELECT environment FROM projects WHERE projects.id = events.project_id)) WHERE event_environment IS NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_event_geography_scope' AND object_id = OBJECT_ID('dbo.events')) CREATE INDEX ix_event_geography_scope ON dbo.events (project_id, event_environment, event_name, timestamp);
INSERT INTO schema_migrations (version, applied_at) SELECT 3, CONVERT(VARCHAR(23), SYSUTCDATETIME(), 126) + 'Z' WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = 3);
COMMIT;
