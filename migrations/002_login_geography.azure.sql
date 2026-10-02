-- Apply after migration 001. SQLite DDL is applied once; Azure DDL is idempotent.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.events', 'login_success') IS NULL ALTER TABLE dbo.events ADD login_success INT NULL;

IF COL_LENGTH('dbo.events', 'login_environment') IS NULL ALTER TABLE dbo.events ADD login_environment VARCHAR(40) NULL;

IF COL_LENGTH('dbo.events', 'auth_provider') IS NULL ALTER TABLE dbo.events ADD auth_provider NVARCHAR(80) NULL;

IF COL_LENGTH('dbo.events', 'correlation_id') IS NULL ALTER TABLE dbo.events ADD correlation_id VARCHAR(128) NULL;

IF COL_LENGTH('dbo.events', 'ip_hash') IS NULL ALTER TABLE dbo.events ADD ip_hash VARCHAR(64) NULL;

IF COL_LENGTH('dbo.events', 'country_code') IS NULL ALTER TABLE dbo.events ADD country_code VARCHAR(2) NULL;

IF COL_LENGTH('dbo.events', 'country_name') IS NULL ALTER TABLE dbo.events ADD country_name NVARCHAR(120) NULL;

IF COL_LENGTH('dbo.events', 'region') IS NULL ALTER TABLE dbo.events ADD region NVARCHAR(120) NULL;

IF COL_LENGTH('dbo.events', 'city') IS NULL ALTER TABLE dbo.events ADD city NVARCHAR(120) NULL;

IF COL_LENGTH('dbo.events', 'latitude') IS NULL ALTER TABLE dbo.events ADD latitude FLOAT NULL;

IF COL_LENGTH('dbo.events', 'longitude') IS NULL ALTER TABLE dbo.events ADD longitude FLOAT NULL;

IF COL_LENGTH('dbo.events', 'timezone') IS NULL ALTER TABLE dbo.events ADD timezone VARCHAR(80) NULL;

IF COL_LENGTH('dbo.events', 'location_accuracy_level') IS NULL ALTER TABLE dbo.events ADD location_accuracy_level VARCHAR(20) NULL;

IF COL_LENGTH('dbo.events', 'accuracy_radius') IS NULL ALTER TABLE dbo.events ADD accuracy_radius FLOAT NULL;

IF COL_LENGTH('dbo.events', 'geo_provider') IS NULL ALTER TABLE dbo.events ADD geo_provider VARCHAR(80) NULL;

IF COL_LENGTH('dbo.events', 'geo_enrichment_status') IS NULL ALTER TABLE dbo.events ADD geo_enrichment_status VARCHAR(20) NULL;

IF COL_LENGTH('dbo.events', 'is_vpn') IS NULL ALTER TABLE dbo.events ADD is_vpn INT NULL;

IF COL_LENGTH('dbo.events', 'is_proxy') IS NULL ALTER TABLE dbo.events ADD is_proxy INT NULL;

IF COL_LENGTH('dbo.events', 'is_hosting_provider') IS NULL ALTER TABLE dbo.events ADD is_hosting_provider INT NULL;

IF COL_LENGTH('dbo.events', 'is_tor') IS NULL ALTER TABLE dbo.events ADD is_tor INT NULL;

IF COL_LENGTH('dbo.events', 'enriched_at') IS NULL ALTER TABLE dbo.events ADD enriched_at VARCHAR(24) NULL;

IF OBJECT_ID('dbo.geo_jobs', 'U') IS NULL CREATE TABLE dbo.geo_jobs (event_id VARCHAR(128) PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE, encrypted_ip VARCHAR(256) NULL, country_code VARCHAR(2) NULL, expires_at VARCHAR(24) NOT NULL, lease_until VARCHAR(24) NULL, lease_token VARCHAR(128) NULL);

IF OBJECT_ID('dbo.geo_cache', 'U') IS NULL CREATE TABLE dbo.geo_cache (cache_key VARCHAR(64) PRIMARY KEY, location_json NVARCHAR(MAX) NOT NULL, expires_at VARCHAR(24) NOT NULL);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_login_time' AND object_id = OBJECT_ID('dbo.events')) CREATE INDEX ix_login_time ON dbo.events (login_success, timestamp);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_login_project' AND object_id = OBJECT_ID('dbo.events')) CREATE INDEX ix_login_project ON dbo.events (project_id, login_environment, login_success, timestamp);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_login_country' AND object_id = OBJECT_ID('dbo.events')) CREATE INDEX ix_login_country ON dbo.events (country_code, timestamp);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_login_location' AND object_id = OBJECT_ID('dbo.events')) CREATE INDEX ix_login_location ON dbo.events (country_code, region, city, timestamp);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_login_enrichment' AND object_id = OBJECT_ID('dbo.events')) CREATE INDEX ix_login_enrichment ON dbo.events (geo_enrichment_status, timestamp);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_geo_jobs_expiry' AND object_id = OBJECT_ID('dbo.geo_jobs')) CREATE INDEX ix_geo_jobs_expiry ON dbo.geo_jobs (expires_at, lease_until);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_geo_cache_expiry' AND object_id = OBJECT_ID('dbo.geo_cache')) CREATE INDEX ix_geo_cache_expiry ON dbo.geo_cache (expires_at);
INSERT INTO schema_migrations (version, applied_at) SELECT 2, CONVERT(VARCHAR(23), SYSUTCDATETIME(), 126) + 'Z' WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = 2);
COMMIT;
