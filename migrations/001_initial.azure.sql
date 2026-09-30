-- House Edge initial Azure SQL schema. Timestamps are canonical UTC ISO-8601 strings.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID('dbo.schema_migrations', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.schema_migrations (version INT PRIMARY KEY, applied_at VARCHAR(24) NOT NULL);
END;

IF OBJECT_ID('dbo.projects', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.projects (id VARCHAR(128) PRIMARY KEY, project_key VARCHAR(80) NOT NULL UNIQUE, name NVARCHAR(120) NOT NULL, domain VARCHAR(253) NOT NULL, environment VARCHAR(40) NOT NULL, color VARCHAR(20) NOT NULL, active INT NOT NULL DEFAULT 1, created_at VARCHAR(24) NOT NULL, allowed_origins NVARCHAR(MAX) NOT NULL, blocked_properties NVARCHAR(MAX) NOT NULL);
END;

IF OBJECT_ID('dbo.api_keys', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.api_keys (id VARCHAR(128) PRIMARY KEY, project_id VARCHAR(128) NOT NULL REFERENCES projects(id), key_hash VARCHAR(64) NOT NULL UNIQUE, prefix VARCHAR(16) NOT NULL, scope VARCHAR(20) NOT NULL, created_at VARCHAR(24) NOT NULL, revoked_at VARCHAR(24) NULL);
END;

IF OBJECT_ID('dbo.events', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.events (id VARCHAR(128) PRIMARY KEY, project_id VARCHAR(128) NOT NULL REFERENCES projects(id), event_name VARCHAR(120) NOT NULL, timestamp VARCHAR(24) NOT NULL, session_id VARCHAR(128) NOT NULL, anonymous_id VARCHAR(128) NOT NULL, user_id VARCHAR(128) NULL, path NVARCHAR(1024) NOT NULL, referrer NVARCHAR(1024) NOT NULL, properties_json NVARCHAR(MAX) NOT NULL, device_type VARCHAR(20) NOT NULL, browser VARCHAR(80) NOT NULL, operating_system VARCHAR(80) NOT NULL, country VARCHAR(2) NOT NULL, duration_ms FLOAT NULL, app_version VARCHAR(80) NOT NULL, error_fingerprint VARCHAR(64) NULL);
END;

IF OBJECT_ID('dbo.sessions', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.sessions (project_id VARCHAR(128) NOT NULL REFERENCES projects(id), session_id VARCHAR(128) NOT NULL, anonymous_id VARCHAR(128) NOT NULL, user_id VARCHAR(128) NULL, first_seen VARCHAR(24) NOT NULL, last_seen VARCHAR(24) NOT NULL, duration_ms FLOAT NOT NULL, page_views INT NOT NULL, event_count INT NOT NULL, landing_page NVARCHAR(1024) NOT NULL, exit_page NVARCHAR(1024) NOT NULL, referrer NVARCHAR(1024) NOT NULL, browser VARCHAR(80) NOT NULL, device_type VARCHAR(20) NOT NULL, PRIMARY KEY (project_id, session_id));
END;

IF OBJECT_ID('dbo.analytics_users', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.analytics_users (project_id VARCHAR(128) NOT NULL REFERENCES projects(id), anonymous_id VARCHAR(128) NOT NULL, identified_user_id VARCHAR(128) NULL, first_seen VARCHAR(24) NOT NULL, last_seen VARCHAR(24) NOT NULL, total_sessions INT NOT NULL, total_events INT NOT NULL, PRIMARY KEY (project_id, anonymous_id));
END;

IF OBJECT_ID('dbo.daily_users', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.daily_users (project_id VARCHAR(128) NOT NULL REFERENCES projects(id), day VARCHAR(10) NOT NULL, anonymous_id VARCHAR(128) NOT NULL, PRIMARY KEY (project_id, day, anonymous_id));
END;

IF OBJECT_ID('dbo.daily_rollups', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.daily_rollups (project_id VARCHAR(128) NOT NULL REFERENCES projects(id), day VARCHAR(10) NOT NULL, users INT NOT NULL, sessions INT NOT NULL, page_views INT NOT NULL, events INT NOT NULL, conversions INT NOT NULL, errors INT NOT NULL, total_duration_ms FLOAT NOT NULL, performance_count INT NOT NULL, PRIMARY KEY (project_id, day));
END;

IF OBJECT_ID('dbo.deployments', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.deployments (id VARCHAR(128) PRIMARY KEY, project_id VARCHAR(128) NOT NULL REFERENCES projects(id), version VARCHAR(80) NOT NULL, commit_sha VARCHAR(64) NOT NULL, environment VARCHAR(40) NOT NULL, deployed_at VARCHAR(24) NOT NULL);
END;

IF OBJECT_ID('dbo.features', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.features (id VARCHAR(128) PRIMARY KEY, project_id VARCHAR(128) NOT NULL REFERENCES projects(id), name NVARCHAR(120) NOT NULL, event_name VARCHAR(120) NOT NULL, created_at VARCHAR(24) NOT NULL, UNIQUE (project_id, event_name));
END;

IF OBJECT_ID('dbo.funnels', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.funnels (id VARCHAR(128) PRIMARY KEY, name NVARCHAR(120) NOT NULL, project_id VARCHAR(128) NULL REFERENCES projects(id), steps_json NVARCHAR(MAX) NOT NULL, window_hours INT NOT NULL, created_at VARCHAR(24) NOT NULL);
END;

IF OBJECT_ID('dbo.saved_views', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.saved_views (id VARCHAR(128) PRIMARY KEY, name NVARCHAR(120) NOT NULL, view_type VARCHAR(40) NOT NULL, filters_json NVARCHAR(MAX) NOT NULL, created_at VARCHAR(24) NOT NULL);
END;

IF OBJECT_ID('dbo.alerts', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.alerts (id VARCHAR(128) PRIMARY KEY, name NVARCHAR(120) NOT NULL, project_id VARCHAR(128) NULL REFERENCES projects(id), metric VARCHAR(40) NOT NULL, operator VARCHAR(4) NOT NULL, threshold FLOAT NOT NULL, enabled INT NOT NULL, created_at VARCHAR(24) NOT NULL);
END;

IF OBJECT_ID('dbo.alert_incidents', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.alert_incidents (id VARCHAR(128) PRIMARY KEY, alert_id VARCHAR(128) NOT NULL REFERENCES alerts(id), value FLOAT NOT NULL, message NVARCHAR(1024) NOT NULL, created_at VARCHAR(24) NOT NULL, notified_at VARCHAR(24) NULL);
END;

IF OBJECT_ID('dbo.audit_logs', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.audit_logs (id VARCHAR(128) PRIMARY KEY, action VARCHAR(80) NOT NULL, target VARCHAR(128) NOT NULL, details_json NVARCHAR(MAX) NOT NULL, created_at VARCHAR(24) NOT NULL);
END;

IF OBJECT_ID('dbo.rate_limits', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.rate_limits (bucket VARCHAR(200) PRIMARY KEY, count INT NOT NULL, expires_at VARCHAR(24) NOT NULL);
END;

IF OBJECT_ID('dbo.settings', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.settings (setting_key VARCHAR(80) PRIMARY KEY, value NVARCHAR(MAX) NOT NULL);
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_events_project_time' AND object_id = OBJECT_ID('dbo.events'))
  CREATE INDEX ix_events_project_time ON dbo.events (project_id, timestamp);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_events_time' AND object_id = OBJECT_ID('dbo.events'))
  CREATE INDEX ix_events_time ON dbo.events (timestamp);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_events_name_time' AND object_id = OBJECT_ID('dbo.events'))
  CREATE INDEX ix_events_name_time ON dbo.events (event_name, timestamp);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_events_session' AND object_id = OBJECT_ID('dbo.events'))
  CREATE INDEX ix_events_session ON dbo.events (project_id, session_id, timestamp);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_events_user' AND object_id = OBJECT_ID('dbo.events'))
  CREATE INDEX ix_events_user ON dbo.events (project_id, anonymous_id, timestamp);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_events_errors' AND object_id = OBJECT_ID('dbo.events'))
  CREATE INDEX ix_events_errors ON dbo.events (project_id, error_fingerprint, timestamp);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_sessions_time' AND object_id = OBJECT_ID('dbo.sessions'))
  CREATE INDEX ix_sessions_time ON dbo.sessions (project_id, first_seen);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_users_seen' AND object_id = OBJECT_ID('dbo.analytics_users'))
  CREATE INDEX ix_users_seen ON dbo.analytics_users (project_id, last_seen);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_daily_users_day' AND object_id = OBJECT_ID('dbo.daily_users'))
  CREATE INDEX ix_daily_users_day ON dbo.daily_users (day, project_id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_rollups_day' AND object_id = OBJECT_ID('dbo.daily_rollups'))
  CREATE INDEX ix_rollups_day ON dbo.daily_rollups (day, project_id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_deployments_time' AND object_id = OBJECT_ID('dbo.deployments'))
  CREATE INDEX ix_deployments_time ON dbo.deployments (project_id, deployed_at);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_audit_time' AND object_id = OBJECT_ID('dbo.audit_logs'))
  CREATE INDEX ix_audit_time ON dbo.audit_logs (created_at);
COMMIT TRANSACTION;
