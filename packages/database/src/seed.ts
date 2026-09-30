import { randomUUID } from 'node:crypto';
import type { AnalyticsEvent, Project } from '@house-edge/shared';
import type { Connection } from './connection';
import { createProject, ingest, rebuildAllRollups } from './repository';

const demoProjects = [
  ['Repo Reaper', 'repo-reaper', 'reporeaper.dev', '#a58bfa', 42, 'repository_analyzed', 'README Generator', 'readme_generated'],
  ['Deck', 'deck', 'deck.so', '#55c8a1', 35, 'task_created', 'Board View', 'board_opened'],
  ['Shipwreck', 'shipwreck', 'shipwreck.dev', '#6aacf1', 28, 'project_opened', 'Quick Export', 'project_exported'],
  ['Save Scum', 'save-scum', 'savescum.gg', '#eda269', 25, 'save_downloaded', 'Cloud Backup', 'backup_created'],
  ['Diffusion', 'diffusion', 'diffusion.app', '#e282b7', 22, 'image_generated', 'Graph View', 'graph_opened'],
  ['Env Reaper', 'env-reaper', 'envreaper.dev', '#d6bd73', 18, 'environment_scanned', 'Secret Detection', 'secret_detected'],
  ['Rippley Labs', 'rippley-labs', 'rippleylabs.com', '#80c5d3', 30, 'project_clicked', 'Project Directory', 'directory_opened'],
  ['Algebra Quest', 'algebra-quest', 'algebraquest.app', '#85b76e', 16, 'lesson_completed', 'Practice Mode', 'practice_started'],
  ['Pit Boss', 'pit-boss', 'pitboss.dev', '#cb7d72', 12, 'deployment_created', 'Pipeline View', 'pipeline_opened'],
] as const;
let randomState = 42627;
function random() { randomState = (randomState * 1664525 + 1013904223) >>> 0; return randomState / 4294967296; }
function pick<T>(items: readonly T[]) { return items[Math.floor(random() * items.length)]; }

export async function seed(db: Connection) {
  const existing = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM projects');
  if (existing[0].n) return { skipped: true };
  randomState = 42627;
  const now = Date.now(); const dayStart = new Date().setUTCHours(0, 0, 0, 0);
  for (let p = 0; p < demoProjects.length; p++) {
    const [name, key, domain, color, base, featureEvent, featureName, secondary] = demoProjects[p];
    const created = await createProject(db, { name, projectKey: key, domain, color, environment: 'production', origins: [`https://${domain}`, 'http://localhost:3000'] });
    const [project] = await db.query<Project>('SELECT * FROM projects WHERE id = @id', { id: created.id });
    for (let day = 89; day >= 0; day--) {
      const date = dayStart - day * 86400000;
      const trend = p === 2 ? 1.15 - (89 - day) * .004 : .6 + (89 - day) * .011;
      const weekday = new Date(date).getUTCDay();
      const sessions = Math.round(base * trend * (weekday === 0 || weekday === 6 ? .68 : 1) * (.85 + random() * .3));
      const batch: AnalyticsEvent[] = [];
      for (let s = 0; s < sessions; s++) {
        const start = date + Math.floor(random() * Math.min(86000000, Math.max(1000, now - date - 600000)));
        const sessionId = randomUUID();
        const anonymousId = `${key}-visitor-${Math.floor(random() * (base * 12))}`;
        const browser = pick(['Chrome', 'Chrome', 'Chrome', 'Safari', 'Firefox', 'Edge']);
        const deviceType = pick(['desktop', 'desktop', 'desktop', 'mobile', 'tablet'] as const);
        const userId = random() > .4 ? `user_${anonymousId.split('-').at(-1)}` : undefined;
        const referrer = pick(['https://github.com', 'https://www.google.com', 'https://rippleylabs.com', '', '', 'https://news.ycombinator.com']);
        const version = day < 4 ? '1.4.2' : day < 18 ? '1.4.1' : '1.3.0';
        const flow = ['session_start', 'page_view'];
        if (random() > .15) flow.push('login', 'page_view', featureEvent);
        if (flow.length > 3 && random() > .28) flow.push(secondary, 'page_view');
        if (random() > .85) flow.push('conversion');
        if (random() > .85 && day > 35) flow.push('legacy_export');
        if (random() > .4) flow.push('performance');
        if (random() < (p === 5 && day < 3 ? .25 : .035)) flow.push('error');
        flow.push('session_end');
        for (let step = 0; step < flow.length; step++) {
          const event = flow[step];
          const timestamp = Math.min(now - 1000, start + step * (8000 + Math.floor(random() * 28000)));
          const properties: AnalyticsEvent['properties'] = event === 'performance' ? { metric: pick(['LCP', 'INP', 'TTFB', 'page_load']), value: 200 + Math.round(random() * 1800) }
            : event === 'error' ? { name: pick(['TypeError', 'NetworkError', 'TimeoutError']), message: pick(['Failed to fetch repository metadata', 'Request exceeded 5000ms timeout', 'Cannot read properties of undefined (reading \'id\')']), stack: 'at loadProject (src/lib/projects.ts:42:18)\nat async Dashboard (src/app/page.tsx:28:5)' }
            : event === featureEvent ? { language: pick(['TypeScript', 'Rust', 'Python', 'Go']), source: pick(['dashboard', 'command_palette', 'shortcut']) }
            : { source: 'demo', ...(step === 1 ? { utm_source: pick(['github', 'google', 'direct']) } : {}) };
          batch.push({ id: randomUUID(), event, sessionId, anonymousId, userId, timestamp: new Date(timestamp).toISOString(),
            path: step < 3 ? '/' : step < 6 ? '/dashboard' : '/projects/demo', referrer, properties,
            deviceType, browser, operatingSystem: deviceType === 'mobile' ? 'iOS' : pick(['macOS', 'Windows', 'Linux']),
            country: pick(['US', 'US', 'GB', 'DE', 'CA', 'FR', 'IN', 'AU']), version,
            durationMs: event === 'performance' ? Number(properties.value) : event === featureEvent ? Math.floor(300 + random() * 2200) : undefined,
          });
        }
      }
      if (batch.length) await ingest(db, project, batch, { skipRollups: true });
    }
    await db.transaction(async tx => {
      for (const [feature, event] of [[name === 'Repo Reaper' ? 'Repository Analysis' : featureEvent.replaceAll('_', ' ').replace(/^./, x => x.toUpperCase()), featureEvent], [featureName, secondary], ['Legacy Export', 'legacy_export']]) {
        await tx.execute('INSERT INTO features (id, project_id, name, event_name, created_at) VALUES (@id, @project, @name, @event, @now)', { id: randomUUID(), project: project.id, name: feature, event, now: new Date(dayStart - 90 * 86400000).toISOString() });
      }
      for (const [days, version] of [[3, '1.4.2'], [17, '1.4.1'], [40, '1.3.0']] as const) {
        await tx.execute('INSERT INTO deployments (id, project_id, version, commit_sha, environment, deployed_at) VALUES (@id, @project, @version, @sha, @environment, @at)', {
          id: randomUUID(), project: project.id, version, sha: randomUUID().replaceAll('-', '').slice(0, 7), environment: 'production', at: new Date(dayStart - days * 86400000 + p * 3600000).toISOString(),
        });
      }
      await tx.execute('INSERT INTO funnels (id, name, project_id, steps_json, window_hours, created_at) VALUES (@id, @name, @project, @steps, 24, @now)', {
        id: randomUUID(), name: `${name} activation`, project: project.id, steps: JSON.stringify(['page_view', 'login', featureEvent, secondary]), now: new Date().toISOString(),
      });
    });
  }
  await rebuildAllRollups(db);
  await db.transaction(async tx => {
    for (const [name, metric, operator, threshold] of [['Elevated error rate', 'error_rate', 'gt', 5], ['Slow response time', 'p95_latency', 'gt', 2000], ['Collector silence', 'silence_minutes', 'gt', 30]] as const) {
      await tx.execute('INSERT INTO alerts (id, name, project_id, metric, operator, threshold, enabled, created_at) VALUES (@id, @name, NULL, @metric, @operator, @threshold, 1, @now)', { id: randomUUID(), name, metric, operator, threshold, now: new Date().toISOString() });
    }
  });
  return { skipped: false };
}

const liveState = globalThis as unknown as { houseEdgeDemoTick?: number };
export async function tickDemo(db: Connection) {
  if (Date.now() - (liveState.houseEdgeDemoTick || 0) < 10000) return;
  liveState.houseEdgeDemoTick = Date.now();
  const projects = await db.query<Project>('SELECT * FROM projects WHERE active = 1');
  for (const project of projects.filter(p => demoProjects.some(d => d[1] === p.project_key)).slice(0, 6)) {
    const def = demoProjects.find(p => p[1] === project.project_key)!;
    const sessionId = `demo-live-${project.project_key}-${Math.floor(Date.now() / 1800000)}`;
    await ingest(db, project, [{ id: randomUUID(), event: random() > .4 ? def[5] : 'page_view', anonymousId: `demo-live-${project.project_key}`, sessionId,
      timestamp: new Date().toISOString(), path: '/dashboard', properties: { source: 'demo', language: pick(['Rust', 'TypeScript', 'Python']) }, browser: 'Chrome', deviceType: 'desktop', operatingSystem: 'macOS', version: '1.4.2', country: 'US' }]);
  }
}
