export function geographySchemaStatements(dialect: 'sqlite' | 'azure'): string[] {
  const columns: Record<string, string> = {
    login_success: 'INT NULL',
    login_environment: 'VARCHAR(40) NULL',
    auth_provider: 'NVARCHAR(80) NULL',
    correlation_id: 'VARCHAR(128) NULL',
    ip_hash: 'VARCHAR(64) NULL',
    country_code: 'VARCHAR(2) NULL',
    country_name: 'NVARCHAR(120) NULL',
    region: 'NVARCHAR(120) NULL',
    city: 'NVARCHAR(120) NULL',
    latitude: 'FLOAT NULL',
    longitude: 'FLOAT NULL',
    timezone: 'VARCHAR(80) NULL',
    location_accuracy_level: 'VARCHAR(20) NULL',
    accuracy_radius: 'FLOAT NULL',
    geo_provider: 'VARCHAR(80) NULL',
    geo_enrichment_status: 'VARCHAR(20) NULL',
    is_vpn: 'INT NULL',
    is_proxy: 'INT NULL',
    is_hosting_provider: 'INT NULL',
    is_tor: 'INT NULL',
    enriched_at: 'VARCHAR(24) NULL',
  };
  const text = dialect === 'azure' ? 'NVARCHAR(MAX)' : 'TEXT';
  const tables: Record<string, string> = {
    geo_jobs: `event_id VARCHAR(128) PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE, encrypted_ip VARCHAR(256) NULL, country_code VARCHAR(2) NULL, expires_at VARCHAR(24) NOT NULL, lease_until VARCHAR(24) NULL, lease_token VARCHAR(128) NULL`,
    geo_cache: `cache_key VARCHAR(64) PRIMARY KEY, location_json ${text} NOT NULL, expires_at VARCHAR(24) NOT NULL`,
  };
  const indexes: [string, string, string][] = [
    ['ix_login_time', 'events', 'login_success, timestamp'],
    ['ix_login_project', 'events', 'project_id, login_environment, login_success, timestamp'],
    ['ix_login_country', 'events', 'country_code, timestamp'],
    ['ix_login_location', 'events', 'country_code, region, city, timestamp'],
    ['ix_login_enrichment', 'events', 'geo_enrichment_status, timestamp'],
    ['ix_geo_jobs_expiry', 'geo_jobs', 'expires_at, lease_until'],
    ['ix_geo_cache_expiry', 'geo_cache', 'expires_at'],
  ];
  return [
    ...Object.entries(columns).map(([name, type]) =>
      dialect === 'sqlite'
        ? `ALTER TABLE events ADD COLUMN ${name} ${type};`
        : `IF COL_LENGTH('dbo.events', '${name}') IS NULL ALTER TABLE dbo.events ADD ${name} ${type};`,
    ),
    ...Object.entries(tables).map(([name, cols]) =>
      dialect === 'sqlite'
        ? `CREATE TABLE IF NOT EXISTS ${name} (${cols});`
        : `IF OBJECT_ID('dbo.${name}', 'U') IS NULL CREATE TABLE dbo.${name} (${cols});`,
    ),
    ...indexes.map(([name, table, cols]) =>
      dialect === 'sqlite'
        ? `CREATE INDEX IF NOT EXISTS ${name} ON ${table} (${cols});`
        : `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = '${name}' AND object_id = OBJECT_ID('dbo.${table}')) CREATE INDEX ${name} ON dbo.${table} (${cols});`,
    ),
  ];
}

// Additive expansion of migration 002; retain login columns and contracts.
export function eventGeographySchemaStatements(dialect: 'sqlite' | 'azure'): string[] {
  return [
    dialect === 'sqlite'
      ? 'ALTER TABLE events ADD COLUMN event_environment VARCHAR(40) NULL;'
      : "IF COL_LENGTH('dbo.events', 'event_environment') IS NULL ALTER TABLE dbo.events ADD event_environment VARCHAR(40) NULL;",
    'UPDATE events SET event_environment = COALESCE(login_environment, (SELECT environment FROM projects WHERE projects.id = events.project_id)) WHERE event_environment IS NULL;',
    dialect === 'sqlite'
      ? 'CREATE INDEX IF NOT EXISTS ix_event_geography_scope ON events (project_id, event_environment, event_name, timestamp);'
      : "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_event_geography_scope' AND object_id = OBJECT_ID('dbo.events')) CREATE INDEX ix_event_geography_scope ON dbo.events (project_id, event_environment, event_name, timestamp);",
  ];
}

export function cloudflareGeographySchemaStatements(dialect: 'sqlite' | 'azure'): string[] {
  const columns = {
    region_code: 'VARCHAR(16)',
    postal_code: 'VARCHAR(24)',
    cloudflare_colo: 'VARCHAR(16)',
    network_asn: 'BIGINT',
    network_organization: 'NVARCHAR(200)',
  };
  return [
    ...Object.entries(columns).map(([name, type]) =>
      dialect === 'sqlite'
        ? `ALTER TABLE events ADD COLUMN ${name} ${type} NULL;`
        : `IF COL_LENGTH('dbo.events', '${name}') IS NULL ALTER TABLE dbo.events ADD ${name} ${type} NULL;`,
    ),
    dialect === 'sqlite'
      ? 'CREATE INDEX IF NOT EXISTS ix_geo_visits ON events (project_id, event_name, timestamp, country_code, region, city);'
      : "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_geo_visits' AND object_id = OBJECT_ID('dbo.events')) CREATE INDEX ix_geo_visits ON dbo.events (project_id, event_name, timestamp, country_code, region, city);",
  ];
}
