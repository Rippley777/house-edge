import { scrubText, referrerOrigin } from '../../shared/src/privacy';
/** Non-blocking, privacy-conscious browser analytics. No runtime dependencies. */
export interface HouseEdgeOptions {
  projectKey: string;
  key: string;
  endpoint?: string;
  version?: string;
  environment?: 'production' | 'staging' | 'development' | 'test';
  blockedProperties?: string[];
  autoTrack?: boolean;
  respectDoNotTrack?: boolean;
  enabled?: boolean;
  flushIntervalMs?: number;
  /** Return a canonical path for hash routers or named views. Queries/fragments are stripped. */
  getPath?: () => string;
}
export type EventProperties = Record<string, unknown>;
interface QueuedEvent {
  id: string;
  event: string;
  sessionId: string;
  anonymousId: string;
  userId?: string;
  timestamp: string;
  properties: EventProperties;
  path: string;
  referrer: string;
  deviceType: 'mobile' | 'tablet' | 'desktop';
  browser: string;
  operatingSystem: string;
  durationMs?: number;
  version?: string;
  environment?: 'production' | 'staging' | 'development' | 'test';
}
const blockedDefaults = [
  'password',
  'passwd',
  'secret',
  'token',
  'access_token',
  'refresh_token',
  'authorization',
  'cookie',
  'email',
  'phone',
  'credit_card',
  'ssn',
  'ip',
  'ip_address',
  'source_ip',
  'client_ip',
  'remote_address',
  'x_forwarded_for',
  'cf_connecting_ip',
  'ip_hash',
];
export function redact(value: unknown, blocked: string[] = [], depth = 0): unknown {
  if (depth > 5) return null;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, blocked, depth + 1));
  if (value && typeof value === 'object') {
    const denied = new Set([...blockedDefaults, ...blocked].map((k) => k.toLowerCase().replace(/[^a-z0-9]/g, '')));
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 50)
        .filter(
          ([key]) =>
            !denied.has(key.toLowerCase().replace(/[^a-z0-9]/g, '')) &&
            !['__proto__', 'constructor', 'prototype'].includes(key),
        )
        .map(([key, v]) => [key.slice(0, 120), redact(v, blocked, depth + 1)]),
    );
  }
  return typeof value === 'string'
    ? scrubText(value)
    : typeof value === 'number' && !Number.isFinite(value)
      ? null
      : (value ?? null);
}
function uuid() {
  return crypto.randomUUID();
}
function storageGet(storage: Storage, key: string) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}
function storageSet(storage: Storage, key: string, value: string) {
  try {
    storage.setItem(key, value);
  } catch {
    /* Storage is optional. */
  }
}

export function createHouseEdge() {
  let config: HouseEdgeOptions | undefined;
  let queue: QueuedEvent[] = [];
  let anonymousId = '';
  let userId: string | undefined;
  let sessionId = '';
  let lastSeen = 0;
  let busy = false;
  let retries = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let enabled = false;
  let cleanup: (() => void)[] = [];
  let generation = 0;
  let activeRequest: AbortController | undefined;
  const attempts = new Map<string, number>();
  let dropped = 0;
  let status = 'uninitialized';
  const currentPath = () => {
    try {
      return new URL(config?.getPath?.() || location.pathname, location.origin).pathname;
    } catch {
      return location.pathname;
    }
  };
  const schedule = (delay?: number) => {
    if (!enabled || timer) return;
    timer = setTimeout(
      () => {
        timer = undefined;
        void flush();
      },
      delay ?? config?.flushIntervalMs ?? 5000,
    );
  };
  const session = () => {
    const now = Date.now();
    if (!sessionId || now - lastSeen > 1800000) {
      sessionId = uuid();
      lastSeen = now;
      track('session_start');
    }
    lastSeen = now;
    try {
      storageSet(sessionStorage, `he_session_${config!.projectKey}`, JSON.stringify({ id: sessionId, at: now }));
    } catch {
      /* Restricted context. */
    }
    return sessionId;
  };
  function track(event: string, properties: EventProperties = {}, durationMs?: number) {
    if (!enabled || !config || typeof window === 'undefined') return;
    try {
      const id = session();
      const ua = navigator.userAgent;
      const entry: QueuedEvent = {
        id: uuid(),
        event: event.slice(0, 120),
        sessionId: id,
        anonymousId,
        userId,
        timestamp: new Date().toISOString(),
        properties: redact(properties, config.blockedProperties) as EventProperties,
        path: currentPath(),
        referrer: referrerOrigin(document.referrer),
        deviceType: /iPad|Tablet/i.test(ua) ? 'tablet' : /Mobi|Android/i.test(ua) ? 'mobile' : 'desktop',
        browser: /Edg\//.test(ua)
          ? 'Edge'
          : /Firefox\//.test(ua)
            ? 'Firefox'
            : /Chrome\//.test(ua)
              ? 'Chrome'
              : /Safari\//.test(ua)
                ? 'Safari'
                : 'Other',
        operatingSystem: /iPhone|iPad/.test(ua)
          ? 'iOS'
          : /Android/.test(ua)
            ? 'Android'
            : /Windows/.test(ua)
              ? 'Windows'
              : /Mac/.test(ua)
                ? 'macOS'
                : /Linux/.test(ua)
                  ? 'Linux'
                  : 'Other',
        version: config.version,
        environment: config.environment,
        ...((durationMs ?? properties.durationMs) !== undefined &&
        typeof (durationMs ?? properties.durationMs) === 'number' &&
        Number.isFinite(durationMs ?? properties.durationMs) &&
        Number(durationMs ?? properties.durationMs) >= 0
          ? { durationMs: Math.min(Number(durationMs ?? properties.durationMs), 86400000) }
          : {}),
      };
      if (new TextEncoder().encode(JSON.stringify(entry)).length > 16000) return;
      queue.push(entry);
      if (queue.length > 200) queue.shift();
      if (queue.length >= 20 && retries === 0) void flush();
      else schedule();
    } catch {
      /* Analytics never throws into the host application. */
    }
  }
  async function flush(beacon = false): Promise<void> {
    if (!config || busy || !queue.length || !enabled) return;
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    const batch: QueuedEvent[] = [];
    let size = 0;
    for (const e of queue.slice(0, 20)) {
      const length = new TextEncoder().encode(JSON.stringify(e)).length;
      if (size + length > 55000) break;
      size += length;
      batch.push(e);
    }
    if (!batch.length) return;
    const body = JSON.stringify({ projectKey: config.projectKey, key: config.key, events: batch });
    const endpoint = config.endpoint || '/api/collect';
    if (beacon) {
      try {
        if (navigator.sendBeacon(endpoint, new Blob([body], { type: 'text/plain;charset=UTF-8' }))) {
          const sent = new Set(batch.map((e) => e.id));
          queue = queue.filter((e) => !sent.has(e.id));
          return;
        }
      } catch {
        /* Fetch fallback. */
      }
    }
    busy = true;
    const run = generation;
    for (const e of batch) attempts.set(e.id, (attempts.get(e.id) || 0) + 1);
    try {
      const controller = new AbortController();
      activeRequest = controller;
      const timeout = setTimeout(() => controller.abort(), 8000);
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          body,
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          credentials: 'omit',
          keepalive: true,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      if (run !== generation) return;
      status = response.ok ? 'delivered' : `http_${response.status}`;
      if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429)) {
        const sent = new Set(batch.map((e) => e.id));
        queue = queue.filter((e) => !sent.has(e.id));
        retries = 0;
        for (const e of batch) attempts.delete(e.id);
      } else retries++;
    } catch {
      if (run === generation) {
        retries++;
        status = 'network_error';
      }
    } finally {
      if (run === generation) {
        busy = false;
        activeRequest = undefined;
        const exhausted = new Set(batch.filter((e) => (attempts.get(e.id) || 0) >= 5).map((e) => e.id));
        if (exhausted.size) {
          dropped += exhausted.size;
          queue = queue.filter((e) => !exhausted.has(e.id));
          for (const id of exhausted) attempts.delete(id);
          retries = 0;
          status = 'retry_exhausted';
        }
        // Queue eviction must not leave an unbounded retry bookkeeping map.
        const queued = new Set(queue.map((e) => e.id));
        for (const id of attempts.keys()) if (!queued.has(id)) attempts.delete(id);
        if (queue.length) schedule(Math.min(60000, 1000 * 2 ** Math.min(retries, 6)));
      }
    }
  }
  const page = () => {
    const props: EventProperties = {
      hostname: location.hostname,
      screen_width: screen.width,
      screen_height: screen.height,
    };
    const query = new URLSearchParams(location.search);
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
      const value = query.get(key);
      if (value) props[key] = value.slice(0, 120);
    }
    track('page_view', props);
  };
  function destroy() {
    generation++;
    activeRequest?.abort();
    activeRequest = undefined;
    busy = false;
    retries = 0;
    attempts.clear();
    status = 'disabled';
    enabled = false;
    if (timer) clearTimeout(timer);
    timer = undefined;
    cleanup.forEach((fn) => fn());
    cleanup = [];
    queue = [];
  }
  function init(options: HouseEdgeOptions) {
    if (typeof window === 'undefined') return;
    if (
      enabled &&
      config &&
      Object.keys({ ...config, ...options }).every(
        (key) => config![key as keyof HouseEdgeOptions] === options[key as keyof HouseEdgeOptions],
      )
    )
      return;
    destroy();
    config = options;
    if (options.enabled === false || (options.respectDoNotTrack !== false && navigator.doNotTrack === '1')) return;
    if (!options.projectKey || !options.key) {
      status = 'missing_configuration';
      return;
    }
    if (options.key.startsWith('he_sk_')) {
      status = 'invalid_browser_key';
      return;
    }
    try {
      anonymousId = uuid();
      sessionId = '';
      lastSeen = 0;
      userId = undefined;
      try {
        anonymousId = storageGet(localStorage, `he_anon_${options.projectKey}`) || anonymousId;
        storageSet(localStorage, `he_anon_${options.projectKey}`, anonymousId);
        const stored = storageGet(sessionStorage, `he_session_${options.projectKey}`);
        if (stored) {
          const s = JSON.parse(stored);
          if (typeof s.id === 'string' && typeof s.at === 'number') {
            sessionId = s.id;
            lastSeen = s.at;
          }
        }
      } catch {
        /* Anonymous IDs remain in memory when storage is unavailable. */
      }
      enabled = true;
      status = 'ready';
      const run = generation;
      if (options.autoTrack !== false) {
        let lastPath = currentPath();
        page();
        const navigate = () => {
          const path = currentPath();
          if (path !== lastPath) {
            lastPath = path;
            page();
          }
        };
        for (const method of ['pushState', 'replaceState'] as const) {
          const original = history[method];
          const wrapped: History[typeof method] = function (...args) {
            original.apply(history, args);
            navigate();
          };
          history[method] = wrapped;
          cleanup.push(() => {
            if (history[method] === wrapped) history[method] = original;
          });
        }
        window.addEventListener('popstate', navigate);
        cleanup.push(() => window.removeEventListener('popstate', navigate));
        if (options.getPath) {
          window.addEventListener('hashchange', navigate);
          cleanup.push(() => window.removeEventListener('hashchange', navigate));
        }
        // Standard Web Vitals implementation runs only after initial rendering.
        const vitalsTimer = setTimeout(() => {
          if (!enabled || run !== generation) return;
          import('web-vitals')
            .then(({ onLCP, onCLS, onINP, onTTFB }) => {
              if (!enabled || run !== generation) return;
              const report = (m: { name: string; value: number; id: string }) => {
                if (enabled && run === generation)
                  track('performance', { metric: m.name, value: m.value, metric_id: m.id }, m.value);
              };
              onLCP(report);
              onCLS(report);
              onINP(report);
              onTTFB(report);
            })
            .catch(() => {});
          const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
          if (nav?.loadEventEnd)
            track('performance', { metric: 'page_load', value: nav.loadEventEnd }, nav.loadEventEnd);
        }, 2000);
        cleanup.push(() => clearTimeout(vitalsTimer));
        const onError = (e: ErrorEvent) => {
          if (e.error) api.error(e.error, { category: 'exception' });
        };
        const rejection = (e: PromiseRejectionEvent) =>
          api.error(e.reason instanceof Error ? e.reason : new Error('Unhandled promise rejection'), {
            category: 'unhandled_rejection',
          });
        window.addEventListener('error', onError);
        window.addEventListener('unhandledrejection', rejection);
        cleanup.push(() => {
          window.removeEventListener('error', onError);
          window.removeEventListener('unhandledrejection', rejection);
        });
      }
      const hidden = () => {
        if (document.visibilityState === 'hidden') void flush(true);
      };
      const leave = () => {
        track('session_end');
        void flush(true);
      };
      document.addEventListener('visibilitychange', hidden);
      window.addEventListener('pagehide', leave);
      cleanup.push(() => {
        document.removeEventListener('visibilitychange', hidden);
        window.removeEventListener('pagehide', leave);
      });
    } catch {
      destroy();
    }
  }
  const api = {
    getStatus: () => ({ status, enabled, queued: queue.length, dropped }),
    init,
    track,
    page: () => {
      if (enabled) page();
    },
    flush: () => flush(),
    destroy,
    identify(id: string) {
      if (!enabled) return;
      userId = String(id).slice(0, 128);
      track('identify');
    },
    reset() {
      userId = undefined;
      if (!enabled) return;
      anonymousId = uuid();
      sessionId = '';
      try {
        storageSet(localStorage, `he_anon_${config!.projectKey}`, anonymousId);
      } catch {}
    },
    timing(name: string, ms: number) {
      track('performance', { metric: name, value: ms }, ms);
    },
    error(error: Error, properties: EventProperties = {}) {
      track('error', { ...properties, name: error.name, message: error.message, stack: error.stack?.slice(0, 2048) });
    },
  };
  return api;
}
export const houseEdge = createHouseEdge();
