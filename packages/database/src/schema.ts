export function schemaStatements(dialect: 'sqlite' | 'azure'): string[] {
  const text = dialect === 'azure' ? 'NVARCHAR(MAX)' : 'TEXT';
  const tables: Record<string, string> = {
    schema_migrations: 'version INT PRIMARY KEY, applied_at VARCHAR(24) NOT NULL',
    projects: `id VARCHAR(128) PRIMARY KEY, project_key VARCHAR(80) NOT NULL UNIQUE, name NVARCHAR(120) NOT NULL, domain VARCHAR(253) NOT NULL, environment VARCHAR(40) NOT NULL, color VARCHAR(20) NOT NULL, active INT NOT NULL DEFAULT 1, created_at VARCHAR(24) NOT NULL, allowed_origins ${text} NOT NULL, blocked_properties ${text} NOT NULL`,
    api_keys: 'id VARCHAR(128) PRIMARY KEY, project_id VARCHAR(128) NOT NULL REFERENCES projects(id), key_hash VARCHAR(64) NOT NULL UNIQUE, prefix VARCHAR(16) NOT NULL, scope VARCHAR(20) NOT NULL, created_at VARCHAR(24) NOT NULL, revoked_at VARCHAR(24) NULL',
    events: `id VARCHAR(128) PRIMARY KEY, project_id VARCHAR(128) NOT NULL REFERENCES projects(id), event_name VARCHAR(120) NOT NULL, timestamp VARCHAR(24) NOT NULL, session_id VARCHAR(128) NOT NULL, anonymous_id VARCHAR(128) NOT NULL, user_id VARCHAR(128) NULL, path NVARCHAR(1024) NOT NULL, referrer NVARCHAR(1024) NOT NULL, properties_json ${text} NOT NULL, device_type VARCHAR(20) NOT NULL, browser VARCHAR(80) NOT NULL, operating_system VARCHAR(80) NOT NULL, country VARCHAR(2) NOT NULL, duration_ms FLOAT NULL, app_version VARCHAR(80) NOT NULL, error_fingerprint VARCHAR(64) NULL`,
    sessions: 'project_id VARCHAR(128) NOT NULL REFERENCES projects(id), session_id VARCHAR(128) NOT NULL, anonymous_id VARCHAR(128) NOT NULL, user_id VARCHAR(128) NULL, first_seen VARCHAR(24) NOT NULL, last_seen VARCHAR(24) NOT NULL, duration_ms FLOAT NOT NULL, page_views INT NOT NULL, event_count INT NOT NULL, landing_page NVARCHAR(1024) NOT NULL, exit_page NVARCHAR(1024) NOT NULL, referrer NVARCHAR(1024) NOT NULL, browser VARCHAR(80) NOT NULL, device_type VARCHAR(20) NOT NULL, PRIMARY KEY (project_id, session_id)',
    analytics_users: 'project_id VARCHAR(128) NOT NULL REFERENCES projects(id), anonymous_id VARCHAR(128) NOT NULL, identified_user_id VARCHAR(128) NULL, first_seen VARCHAR(24) NOT NULL, last_seen VARCHAR(24) NOT NULL, total_sessions INT NOT NULL, total_events INT NOT NULL, PRIMARY KEY (project_id, anonymous_id)',
    daily_users: 'project_id VARCHAR(128) NOT NULL REFERENCES projects(id), day VARCHAR(10) NOT NULL, anonymous_id VARCHAR(128) NOT NULL, PRIMARY KEY (project_id, day, anonymous_id)',
    daily_rollups: 'project_id VARCHAR(128) NOT NULL REFERENCES projects(id), day VARCHAR(10) NOT NULL, users INT NOT NULL, sessions INT NOT NULL, page_views INT NOT NULL, events INT NOT NULL, conversions INT NOT NULL, errors INT NOT NULL, total_duration_ms FLOAT NOT NULL, performance_count INT NOT NULL, PRIMARY KEY (project_id, day)',
    deployments: 'id VARCHAR(128) PRIMARY KEY, project_id VARCHAR(128) NOT NULL REFERENCES projects(id), version VARCHAR(80) NOT NULL, commit_sha VARCHAR(64) NOT NULL, environment VARCHAR(40) NOT NULL, deployed_at VARCHAR(24) NOT NULL',
    features: 'id VARCHAR(128) PRIMARY KEY, project_id VARCHAR(128) NOT NULL REFERENCES projects(id), name NVARCHAR(120) NOT NULL, event_name VARCHAR(120) NOT NULL, created_at VARCHAR(24) NOT NULL, UNIQUE (project_id, event_name)',
    funnels: `id VARCHAR(128) PRIMARY KEY, name NVARCHAR(120) NOT NULL, project_id VARCHAR(128) NULL REFERENCES projects(id), steps_json ${text} NOT NULL, window_hours INT NOT NULL, created_at VARCHAR(24) NOT NULL`,
    saved_views: `id VARCHAR(128) PRIMARY KEY, name NVARCHAR(120) NOT NULL, view_type VARCHAR(40) NOT NULL, filters_json ${text} NOT NULL, created_at VARCHAR(24) NOT NULL`,
    alerts: 'id VARCHAR(128) PRIMARY KEY, name NVARCHAR(120) NOT NULL, project_id VARCHAR(128) NULL REFERENCES projects(id), metric VARCHAR(40) NOT NULL, operator VARCHAR(4) NOT NULL, threshold FLOAT NOT NULL, enabled INT NOT NULL, created_at VARCHAR(24) NOT NULL',
    alert_incidents: `id VARCHAR(128) PRIMARY KEY, alert_id VARCHAR(128) NOT NULL REFERENCES alerts(id), value FLOAT NOT NULL, message NVARCHAR(1024) NOT NULL, created_at VARCHAR(24) NOT NULL, notified_at VARCHAR(24) NULL`,
    audit_logs: `id VARCHAR(128) PRIMARY KEY, action VARCHAR(80) NOT NULL, target VARCHAR(128) NOT NULL, details_json ${text} NOT NULL, created_at VARCHAR(24) NOT NULL`,
    rate_limits: 'bucket VARCHAR(200) PRIMARY KEY, count INT NOT NULL, expires_at VARCHAR(24) NOT NULL',
    settings: `setting_key VARCHAR(80) PRIMARY KEY, value ${text} NOT NULL`,
  };
  const indexes: [string, string, string][] = [
    ['ix_events_project_time', 'events', 'project_id, timestamp'],
    ['ix_events_time', 'events', 'timestamp'],
    ['ix_events_name_time', 'events', 'event_name, timestamp'],
    ['ix_events_session', 'events', 'project_id, session_id, timestamp'],
    ['ix_events_user', 'events', 'project_id, anonymous_id, timestamp'],
    ['ix_events_errors', 'events', 'project_id, error_fingerprint, timestamp'],
    ['ix_sessions_time', 'sessions', 'project_id, first_seen'],
    ['ix_users_seen', 'analytics_users', 'project_id, last_seen'],
    ['ix_daily_users_day', 'daily_users', 'day, project_id'],
    ['ix_rollups_day', 'daily_rollups', 'day, project_id'],
    ['ix_deployments_time', 'deployments', 'project_id, deployed_at'],
    ['ix_audit_time', 'audit_logs', 'created_at'],
  ];
  return [
    ...Object.entries(tables).map(([name, cols]) => dialect === 'sqlite'
      ? `CREATE TABLE IF NOT EXISTS ${name} (${cols});`
      : `IF OBJECT_ID('dbo.${name}', 'U') IS NULL\nBEGIN\n  CREATE TABLE dbo.${name} (${cols});\nEND;`),
    ...indexes.map(([name, table, cols]) => dialect === 'sqlite'
      ? `CREATE INDEX IF NOT EXISTS ${name} ON ${table} (${cols});`
      : `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = '${name}' AND object_id = OBJECT_ID('dbo.${table}'))\n  CREATE INDEX ${name} ON dbo.${table} (${cols});`),
  ];
}
