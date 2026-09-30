CREATE TABLE IF NOT EXISTS schema_migrations (version INT PRIMARY KEY, applied_at VARCHAR(24) NOT NULL);

CREATE TABLE IF NOT EXISTS projects (id VARCHAR(128) PRIMARY KEY, project_key VARCHAR(80) NOT NULL UNIQUE, name NVARCHAR(120) NOT NULL, domain VARCHAR(253) NOT NULL, environment VARCHAR(40) NOT NULL, color VARCHAR(20) NOT NULL, active INT NOT NULL DEFAULT 1, created_at VARCHAR(24) NOT NULL, allowed_origins TEXT NOT NULL, blocked_properties TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS api_keys (id VARCHAR(128) PRIMARY KEY, project_id VARCHAR(128) NOT NULL REFERENCES projects(id), key_hash VARCHAR(64) NOT NULL UNIQUE, prefix VARCHAR(16) NOT NULL, scope VARCHAR(20) NOT NULL, created_at VARCHAR(24) NOT NULL, revoked_at VARCHAR(24) NULL);

CREATE TABLE IF NOT EXISTS events (id VARCHAR(128) PRIMARY KEY, project_id VARCHAR(128) NOT NULL REFERENCES projects(id), event_name VARCHAR(120) NOT NULL, timestamp VARCHAR(24) NOT NULL, session_id VARCHAR(128) NOT NULL, anonymous_id VARCHAR(128) NOT NULL, user_id VARCHAR(128) NULL, path NVARCHAR(1024) NOT NULL, referrer NVARCHAR(1024) NOT NULL, properties_json TEXT NOT NULL, device_type VARCHAR(20) NOT NULL, browser VARCHAR(80) NOT NULL, operating_system VARCHAR(80) NOT NULL, country VARCHAR(2) NOT NULL, duration_ms FLOAT NULL, app_version VARCHAR(80) NOT NULL, error_fingerprint VARCHAR(64) NULL);

CREATE TABLE IF NOT EXISTS sessions (project_id VARCHAR(128) NOT NULL REFERENCES projects(id), session_id VARCHAR(128) NOT NULL, anonymous_id VARCHAR(128) NOT NULL, user_id VARCHAR(128) NULL, first_seen VARCHAR(24) NOT NULL, last_seen VARCHAR(24) NOT NULL, duration_ms FLOAT NOT NULL, page_views INT NOT NULL, event_count INT NOT NULL, landing_page NVARCHAR(1024) NOT NULL, exit_page NVARCHAR(1024) NOT NULL, referrer NVARCHAR(1024) NOT NULL, browser VARCHAR(80) NOT NULL, device_type VARCHAR(20) NOT NULL, PRIMARY KEY (project_id, session_id));

CREATE TABLE IF NOT EXISTS analytics_users (project_id VARCHAR(128) NOT NULL REFERENCES projects(id), anonymous_id VARCHAR(128) NOT NULL, identified_user_id VARCHAR(128) NULL, first_seen VARCHAR(24) NOT NULL, last_seen VARCHAR(24) NOT NULL, total_sessions INT NOT NULL, total_events INT NOT NULL, PRIMARY KEY (project_id, anonymous_id));

CREATE TABLE IF NOT EXISTS daily_users (project_id VARCHAR(128) NOT NULL REFERENCES projects(id), day VARCHAR(10) NOT NULL, anonymous_id VARCHAR(128) NOT NULL, PRIMARY KEY (project_id, day, anonymous_id));

CREATE TABLE IF NOT EXISTS daily_rollups (project_id VARCHAR(128) NOT NULL REFERENCES projects(id), day VARCHAR(10) NOT NULL, users INT NOT NULL, sessions INT NOT NULL, page_views INT NOT NULL, events INT NOT NULL, conversions INT NOT NULL, errors INT NOT NULL, total_duration_ms FLOAT NOT NULL, performance_count INT NOT NULL, PRIMARY KEY (project_id, day));

CREATE TABLE IF NOT EXISTS deployments (id VARCHAR(128) PRIMARY KEY, project_id VARCHAR(128) NOT NULL REFERENCES projects(id), version VARCHAR(80) NOT NULL, commit_sha VARCHAR(64) NOT NULL, environment VARCHAR(40) NOT NULL, deployed_at VARCHAR(24) NOT NULL);

CREATE TABLE IF NOT EXISTS features (id VARCHAR(128) PRIMARY KEY, project_id VARCHAR(128) NOT NULL REFERENCES projects(id), name NVARCHAR(120) NOT NULL, event_name VARCHAR(120) NOT NULL, created_at VARCHAR(24) NOT NULL, UNIQUE (project_id, event_name));

CREATE TABLE IF NOT EXISTS funnels (id VARCHAR(128) PRIMARY KEY, name NVARCHAR(120) NOT NULL, project_id VARCHAR(128) NULL REFERENCES projects(id), steps_json TEXT NOT NULL, window_hours INT NOT NULL, created_at VARCHAR(24) NOT NULL);

CREATE TABLE IF NOT EXISTS saved_views (id VARCHAR(128) PRIMARY KEY, name NVARCHAR(120) NOT NULL, view_type VARCHAR(40) NOT NULL, filters_json TEXT NOT NULL, created_at VARCHAR(24) NOT NULL);

CREATE TABLE IF NOT EXISTS alerts (id VARCHAR(128) PRIMARY KEY, name NVARCHAR(120) NOT NULL, project_id VARCHAR(128) NULL REFERENCES projects(id), metric VARCHAR(40) NOT NULL, operator VARCHAR(4) NOT NULL, threshold FLOAT NOT NULL, enabled INT NOT NULL, created_at VARCHAR(24) NOT NULL);

CREATE TABLE IF NOT EXISTS alert_incidents (id VARCHAR(128) PRIMARY KEY, alert_id VARCHAR(128) NOT NULL REFERENCES alerts(id), value FLOAT NOT NULL, message NVARCHAR(1024) NOT NULL, created_at VARCHAR(24) NOT NULL, notified_at VARCHAR(24) NULL);

CREATE TABLE IF NOT EXISTS audit_logs (id VARCHAR(128) PRIMARY KEY, action VARCHAR(80) NOT NULL, target VARCHAR(128) NOT NULL, details_json TEXT NOT NULL, created_at VARCHAR(24) NOT NULL);

CREATE TABLE IF NOT EXISTS rate_limits (bucket VARCHAR(200) PRIMARY KEY, count INT NOT NULL, expires_at VARCHAR(24) NOT NULL);

CREATE TABLE IF NOT EXISTS settings (setting_key VARCHAR(80) PRIMARY KEY, value TEXT NOT NULL);

CREATE INDEX IF NOT EXISTS ix_events_project_time ON events (project_id, timestamp);

CREATE INDEX IF NOT EXISTS ix_events_time ON events (timestamp);

CREATE INDEX IF NOT EXISTS ix_events_name_time ON events (event_name, timestamp);

CREATE INDEX IF NOT EXISTS ix_events_session ON events (project_id, session_id, timestamp);

CREATE INDEX IF NOT EXISTS ix_events_user ON events (project_id, anonymous_id, timestamp);

CREATE INDEX IF NOT EXISTS ix_events_errors ON events (project_id, error_fingerprint, timestamp);

CREATE INDEX IF NOT EXISTS ix_sessions_time ON sessions (project_id, first_seen);

CREATE INDEX IF NOT EXISTS ix_users_seen ON analytics_users (project_id, last_seen);

CREATE INDEX IF NOT EXISTS ix_daily_users_day ON daily_users (day, project_id);

CREATE INDEX IF NOT EXISTS ix_rollups_day ON daily_rollups (day, project_id);

CREATE INDEX IF NOT EXISTS ix_deployments_time ON deployments (project_id, deployed_at);

CREATE INDEX IF NOT EXISTS ix_audit_time ON audit_logs (created_at);
