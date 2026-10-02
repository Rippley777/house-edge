-- Apply after migration 001. SQLite DDL is applied once; Azure DDL is idempotent.
BEGIN IMMEDIATE;
ALTER TABLE events ADD COLUMN login_success INT NULL;

ALTER TABLE events ADD COLUMN login_environment VARCHAR(40) NULL;

ALTER TABLE events ADD COLUMN auth_provider NVARCHAR(80) NULL;

ALTER TABLE events ADD COLUMN correlation_id VARCHAR(128) NULL;

ALTER TABLE events ADD COLUMN ip_hash VARCHAR(64) NULL;

ALTER TABLE events ADD COLUMN country_code VARCHAR(2) NULL;

ALTER TABLE events ADD COLUMN country_name NVARCHAR(120) NULL;

ALTER TABLE events ADD COLUMN region NVARCHAR(120) NULL;

ALTER TABLE events ADD COLUMN city NVARCHAR(120) NULL;

ALTER TABLE events ADD COLUMN latitude FLOAT NULL;

ALTER TABLE events ADD COLUMN longitude FLOAT NULL;

ALTER TABLE events ADD COLUMN timezone VARCHAR(80) NULL;

ALTER TABLE events ADD COLUMN location_accuracy_level VARCHAR(20) NULL;

ALTER TABLE events ADD COLUMN accuracy_radius FLOAT NULL;

ALTER TABLE events ADD COLUMN geo_provider VARCHAR(80) NULL;

ALTER TABLE events ADD COLUMN geo_enrichment_status VARCHAR(20) NULL;

ALTER TABLE events ADD COLUMN is_vpn INT NULL;

ALTER TABLE events ADD COLUMN is_proxy INT NULL;

ALTER TABLE events ADD COLUMN is_hosting_provider INT NULL;

ALTER TABLE events ADD COLUMN is_tor INT NULL;

ALTER TABLE events ADD COLUMN enriched_at VARCHAR(24) NULL;

CREATE TABLE IF NOT EXISTS geo_jobs (event_id VARCHAR(128) PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE, encrypted_ip VARCHAR(256) NULL, country_code VARCHAR(2) NULL, expires_at VARCHAR(24) NOT NULL, lease_until VARCHAR(24) NULL, lease_token VARCHAR(128) NULL);

CREATE TABLE IF NOT EXISTS geo_cache (cache_key VARCHAR(64) PRIMARY KEY, location_json TEXT NOT NULL, expires_at VARCHAR(24) NOT NULL);

CREATE INDEX IF NOT EXISTS ix_login_time ON events (login_success, timestamp);

CREATE INDEX IF NOT EXISTS ix_login_project ON events (project_id, login_environment, login_success, timestamp);

CREATE INDEX IF NOT EXISTS ix_login_country ON events (country_code, timestamp);

CREATE INDEX IF NOT EXISTS ix_login_location ON events (country_code, region, city, timestamp);

CREATE INDEX IF NOT EXISTS ix_login_enrichment ON events (geo_enrichment_status, timestamp);

CREATE INDEX IF NOT EXISTS ix_geo_jobs_expiry ON geo_jobs (expires_at, lease_until);

CREATE INDEX IF NOT EXISTS ix_geo_cache_expiry ON geo_cache (expires_at);
INSERT INTO schema_migrations (version, applied_at) SELECT 2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = 2);
COMMIT;
