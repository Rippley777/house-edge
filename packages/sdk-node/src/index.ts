import { randomUUID } from 'node:crypto';
export interface NodeOptions { projectKey: string; key: string; endpoint: string; version?: string; }
export interface Context { sourceIp?: string; environment?: 'production' | 'staging' | 'development' | 'test'; sessionId?: string; anonymousId?: string; userId?: string; path?: string;
  login?: { success: boolean; provider?: string; environment?: 'production' | 'staging' | 'development' | 'test'; correlationId?: string; sourceIp?: string };
}
export function createHouseEdge(options: NodeOptions) {
  let queue: Record<string, unknown>[] = []; let flushing: Promise<void> | undefined;
  const instance = randomUUID();
  const blocked = new Set(['password', 'passwd', 'secret', 'token', 'accesstoken', 'refreshtoken', 'authorization', 'cookie', 'email', 'phone', 'creditcard', 'ssn', 'ip', 'ipaddress', 'sourceip', 'clientip', 'remoteaddress', 'xforwardedfor', 'cfconnectingip', 'iphash']);
  function clean(value: unknown, depth = 0): unknown {
    if (depth > 5) return null;
    if (Array.isArray(value)) return value.slice(0, 50).map(v => clean(v, depth + 1));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 50).filter(([k]) => !blocked.has(k.toLowerCase().replace(/[^a-z0-9]/g, '')) && !['__proto__', 'constructor', 'prototype'].includes(k)).map(([k, v]) => [k, clean(v, depth + 1)]));
    return typeof value === 'string' ? value.slice(0, 2048) : value ?? null;
  }
  function track(event: string, properties: Record<string, unknown> = {}, context: Context = {}) {
    try {
      const item = { id: randomUUID(), event, sessionId: context.sessionId || instance, anonymousId: context.anonymousId || instance,
        userId: context.userId, path: context.path?.split(/[?#]/)[0], login: context.login, sourceIp: context.sourceIp, environment: context.environment, properties: clean(properties), timestamp: new Date().toISOString(), deviceType: 'server', version: options.version,
        ...(event === 'performance' && typeof properties.value === 'number' ? { durationMs: properties.value } : {}) };
      if (Buffer.byteLength(JSON.stringify(item)) > 16000) return;
      queue.push(item); if (queue.length > 200) queue.shift();
    } catch { /* Circular properties must not disrupt the host. */ }
  }
  async function flush() {
    if (flushing) return flushing;
    flushing = (async () => {
      while (queue.length) {
        const batch = queue.slice(0, 3);
        try {
          const response = await fetch(options.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectKey: options.projectKey, key: options.key, events: batch }), signal: AbortSignal.timeout(8000) });
          if (!response.ok) return;
          const sent = new Set(batch.map(e => e.id)); queue = queue.filter(e => !sent.has(e.id));
        } catch { return; }
      }
    })().finally(() => { flushing = undefined; });
    return flushing;
  }
  return { track, flush, timing: (name: string, value: number, context?: Context) => track('performance', { metric: name, value }, context), error: (error: Error, context?: Context) => track('error', { name: error.name, message: error.message, stack: error.stack }, context) };
}
