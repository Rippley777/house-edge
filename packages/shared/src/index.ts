import { z } from 'zod';

export const eventSchema = z.object({
  id: z.string().uuid(),
  event: z.string().min(1).max(120).regex(/^[a-zA-Z0-9_.:$ -]+$/),
  sessionId: z.string().min(1).max(128),
  anonymousId: z.string().min(1).max(128),
  userId: z.string().max(128).optional(),
  timestamp: z.string().datetime().transform(value => new Date(value).toISOString()),
  path: z.string().max(1024).optional(),
  referrer: z.string().max(1024).optional(),
  properties: z.record(z.string().max(120), z.json()).default({}),
  deviceType: z.enum(['desktop', 'mobile', 'tablet', 'server']).optional(),
  browser: z.string().max(80).optional(),
  operatingSystem: z.string().max(80).optional(),
  country: z.string().length(2).optional(),
  durationMs: z.number().finite().min(0).max(86_400_000).optional(),
  version: z.string().max(80).optional(),
});
export const batchSchema = z.object({
  projectKey: z.string().min(1).max(80),
  key: z.string().min(20).max(200),
  events: z.array(eventSchema).min(1).max(100),
});
export type AnalyticsEvent = z.infer<typeof eventSchema>;
export type EventBatch = z.infer<typeof batchSchema>;
export type Properties = Record<string, z.infer<typeof z.json>>;
export const DEFAULT_BLOCKED_PROPERTIES = ['password', 'passwd', 'secret', 'token', 'access_token', 'refresh_token', 'authorization', 'cookie', 'email', 'phone', 'credit_card', 'ssn'];

export function sanitizeProperties(value: unknown, blocked: string[] = [], depth = 0): Properties {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 5) return {};
  const denied = new Set([...DEFAULT_BLOCKED_PROPERTIES, ...blocked].map(k => k.toLowerCase().replace(/[^a-z0-9]/g, '')));
  const clean = (v: unknown, d: number): z.infer<typeof z.json> => {
    if (d > 5) return null;
    if (Array.isArray(v)) return v.slice(0, 50).map(x => clean(x, d + 1));
    if (v && typeof v === 'object') return sanitizeProperties(v, blocked, d);
    if (typeof v === 'string') return v.slice(0, 2048);
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'boolean' || v === null) return v;
    return null;
  };
  return Object.fromEntries(Object.entries(value).slice(0, 50)
    .filter(([key]) => !denied.has(key.toLowerCase().replace(/[^a-z0-9]/g, '')) && !['__proto__', 'constructor', 'prototype'].includes(key))
    .map(([key, v]) => [key.slice(0, 120), clean(v, depth + 1)]));
}

export function cleanUrl(input?: string): string {
  if (!input) return '';
  try {
    const url = new URL(input, 'https://house-edge.local');
    return (url.origin === 'https://house-edge.local' ? '' : url.origin) + url.pathname;
  } catch { return ''; }
}

export interface Project {
  id: string; project_key: string; name: string; domain: string;
  environment: string; color: string; active: number; created_at: string;
  allowed_origins: string; blocked_properties: string;
}
export interface EventRow {
  id: string; project_id: string; event_name: string; timestamp: string;
  session_id: string; anonymous_id: string; user_id: string | null; path: string;
  referrer: string; properties_json: string; device_type: string; browser: string;
  operating_system: string; country: string; duration_ms: number | null; app_version: string;
  project_name?: string; color?: string;
}
export interface Filters { project?: string; from: string; to: string; search?: string; event?: string; property?: string; value?: string; minDuration?: number; }
export interface MetricSet { users: number; sessions: number; pageViews: number; events: number; conversions: number; errors: number; avgDuration: number; }
export interface SeriesPoint { date: string; events: number; users: number; sessions: number; pageViews: number; errors: number; conversions: number; }
export interface ProjectMetrics extends Project, MetricSet {
  activeUsers: number; change: number; previousUsers: number; errorRate: number;
  retentionRate: number; retentionChange: number; errorChange: number;
  p95Latency: number; performanceChange: number; engagementChange: number;
}
export interface Insight { id: string; project: string; projectId: string; title: string; detail: string; kind: 'positive' | 'warning' | 'neutral'; metric: string; value: number; }
export interface Overview {
  current: MetricSet; previous: MetricSet; activeUsers: number; series: SeriesPoint[];
  previousSeries: SeriesPoint[]; projects: ProjectMetrics[]; recent: EventRow[];
  insights: Insight[]; demo: boolean; generatedAt: string;
  deployments: { id: string; project_id: string; project_name: string; version: string; deployed_at: string; commit_sha: string }[];
}
export const change = (current: number, previous: number) => previous ? Math.round((current - previous) / previous * 1000) / 10 : current ? 100 : 0;
export const number = (n: number) => new Intl.NumberFormat('en-US', { notation: n >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(n);
export const duration = (ms: number) => ms < 1000 ? `${Math.round(ms)}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60000)}m ${Math.round(ms % 60000 / 1000)}s`;
