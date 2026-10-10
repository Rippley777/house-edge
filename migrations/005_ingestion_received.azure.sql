-- Apply after migration 004. Historical receive time is unknown.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.events', 'received_at') IS NULL ALTER TABLE dbo.events ADD received_at VARCHAR(24) NULL;
INSERT INTO schema_migrations (version, applied_at) SELECT 5, CONVERT(VARCHAR(23), SYSUTCDATETIME(), 126) + 'Z' WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = 5);
COMMIT;
