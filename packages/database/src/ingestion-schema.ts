/** Additive: historical receive times remain unknown. */
export function ingestionSchemaStatements(dialect: 'sqlite' | 'azure') {
  return [
    dialect === 'sqlite'
      ? 'ALTER TABLE events ADD COLUMN received_at VARCHAR(24) NULL;'
      : "IF COL_LENGTH('dbo.events', 'received_at') IS NULL ALTER TABLE dbo.events ADD received_at VARCHAR(24) NULL;",
  ];
}
