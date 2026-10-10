import { test, expect, type Page } from '@playwright/test';
import type { houseEdge } from '../../packages/sdk-browser/src/index';

declare global {
  interface Window {
    houseEdge: typeof houseEdge;
  }
}
type Event = { event: string; path: string };

async function host(page: Page) {
  const events: Event[] = [];
  await page.route('**/sdk-navigation*', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>SDK navigation</title><script src="/house-edge.js"></script>',
    }),
  );
  await page.route('**/sdk-collect', (route) => {
    events.push(...route.request().postDataJSON().events);
    return route.fulfill({ status: 202, body: '{}' });
  });
  await page.goto('/sdk-navigation');
  await page.waitForFunction(() => !!window.houseEdge);
  return events;
}

test('browser SDK counts paths once and ignores query/hash history navigation', async ({ page }) => {
  const events = await host(page);
  await page.evaluate(async () => {
    window.houseEdge.init({ projectKey: 'navigation', key: 'browser-test', endpoint: '/sdk-collect' });
    history.pushState({}, '', '/second');
    history.replaceState({}, '', '/second?token=private');
    history.pushState({}, '', '/second?token=private#anchor');
    const back = () =>
      new Promise<void>((resolve) => {
        window.addEventListener('popstate', () => resolve(), { once: true });
        history.back();
      });
    await back(); // Query/hash-only traversal must not count another page view.
    await back(); // Returning to the first path must count.
    await window.houseEdge.flush();
  });
  expect(events.filter((e) => e.event === 'page_view').map((e) => e.path)).toEqual([
    '/sdk-navigation',
    '/second',
    '/sdk-navigation',
  ]);
  expect(events.filter((e) => e.event === 'session_start')).toHaveLength(1);
});

test('browser SDK tracks canonical hash views and removes its listeners on destroy', async ({ page }) => {
  const events = await host(page);
  await page.evaluate(async () => {
    const paths: Record<string, string> = { '#Collection': '/collection?token=private#anchor' };
    window.houseEdge.init({
      projectKey: 'views',
      key: 'browser-test',
      endpoint: '/sdk-collect',
      getPath: () => paths[location.hash] || '/overview',
    });
    await new Promise<void>((resolve) => {
      window.addEventListener('hashchange', () => resolve(), { once: true });
      location.hash = 'Collection';
    });
    // Browsers can send popstate and hashchange for a single transition.
    window.dispatchEvent(new PopStateEvent('popstate'));
    window.houseEdge.track('collection_opened');
    await window.houseEdge.flush();
    window.houseEdge.destroy();
    history.pushState({}, '', '/after-destroy');
    await window.houseEdge.flush();
  });
  expect(events.filter((e) => e.event === 'page_view').map((e) => e.path)).toEqual(['/overview', '/collection']);
  expect(events.find((e) => e.event === 'collection_opened')?.path).toBe('/collection');
  expect(JSON.stringify(events)).not.toContain('private');
});

test('browser SDK remains silent with Do Not Track or disabled configuration', async ({ page }) => {
  const events = await host(page);
  await page.evaluate(async () => {
    Object.defineProperty(navigator, 'doNotTrack', { configurable: true, value: '1' });
    window.houseEdge.init({ projectKey: 'disabled', key: 'browser-test', endpoint: '/sdk-collect' });
    window.houseEdge.track('ignored');
    await window.houseEdge.flush();
    Object.defineProperty(navigator, 'doNotTrack', { configurable: true, value: '0' });
    window.houseEdge.init({ projectKey: 'disabled', key: 'browser-test', endpoint: '/sdk-collect', enabled: false });
    window.houseEdge.page();
    await window.houseEdge.flush();
  });
  expect(events).toEqual([]);
});

test('repeated initialization records one page and retries stop after five failed requests', async ({ page }) => {
  const events = await host(page);
  let calls = 0;
  await page.route('**/sdk-unavailable', (route) => {
    calls++;
    return route.fulfill({ status: 503, body: '{}' });
  });
  const result = await page.evaluate(async () => {
    const options = { projectKey: 'once', key: 'browser-test', endpoint: '/sdk-collect' };
    window.houseEdge.init(options);
    window.houseEdge.init({ ...options });
    await window.houseEdge.flush();
    window.houseEdge.init({ ...options, endpoint: '/sdk-unavailable', autoTrack: false });
    window.houseEdge.track('retry_test');
    for (let i = 0; i < 7; i++) await window.houseEdge.flush();
    return window.houseEdge.getStatus();
  });
  expect(events.filter((e) => e.event === 'page_view')).toHaveLength(1);
  expect(calls).toBe(5);
  expect(result.queued).toBe(0);
  expect(result.status).toBe('retry_exhausted');
});

test('browser refuses server keys and exposes missing configuration without throwing', async ({ page }) => {
  await host(page);
  const states = await page.evaluate(() => {
    window.houseEdge.init({ projectKey: 'bad', key: '' });
    const missing = window.houseEdge.getStatus();
    window.houseEdge.init({ projectKey: 'bad', key: 'he_sk_never-use-in-browser' });
    return [missing, window.houseEdge.getStatus()];
  });
  expect(states.map((s) => s.status)).toEqual(['missing_configuration', 'invalid_browser_key']);
  expect(states.every((s) => !s.enabled)).toBeTruthy();
});
