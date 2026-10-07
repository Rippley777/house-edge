-- Apply after migration 003. Additive nullable columns; no event rewrite.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.events', 'region_code') IS NULL ALTER TABLE dbo.events ADD region_code VARCHAR(16) NULL;
GO
IF COL_LENGTH('dbo.events', 'postal_code') IS NULL ALTER TABLE dbo.events ADD postal_code VARCHAR(24) NULL;
GO
IF COL_LENGTH('dbo.events', 'cloudflare_colo') IS NULL ALTER TABLE dbo.events ADD cloudflare_colo VARCHAR(16) NULL;
GO
IF COL_LENGTH('dbo.events', 'network_asn') IS NULL ALTER TABLE dbo.events ADD network_asn BIGINT NULL;
GO
IF COL_LENGTH('dbo.events', 'network_organization') IS NULL ALTER TABLE dbo.events ADD network_organization NVARCHAR(200) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_geo_visits' AND object_id = OBJECT_ID('dbo.events')) CREATE INDEX ix_geo_visits ON dbo.events (project_id, event_name, timestamp, country_code, region, city);
INSERT INTO schema_migrations (version, applied_at) SELECT 4, CONVERT(VARCHAR(23), SYSUTCDATETIME(), 126) + 'Z' WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = 4);
COMMIT;
