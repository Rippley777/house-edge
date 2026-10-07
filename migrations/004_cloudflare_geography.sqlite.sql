-- Apply after migration 003. Additive nullable columns; no event rewrite.
BEGIN IMMEDIATE;
ALTER TABLE events ADD COLUMN region_code VARCHAR(16) NULL;

ALTER TABLE events ADD COLUMN postal_code VARCHAR(24) NULL;

ALTER TABLE events ADD COLUMN cloudflare_colo VARCHAR(16) NULL;

ALTER TABLE events ADD COLUMN network_asn BIGINT NULL;

ALTER TABLE events ADD COLUMN network_organization NVARCHAR(200) NULL;

CREATE INDEX IF NOT EXISTS ix_geo_visits ON events (project_id, event_name, timestamp, country_code, region, city);
INSERT INTO schema_migrations (version, applied_at) SELECT 4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = 4);
COMMIT;
