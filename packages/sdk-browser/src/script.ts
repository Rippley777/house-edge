import { houseEdge } from './index';
const script = document.currentScript as HTMLScriptElement | null;
if (script?.dataset.project && script?.dataset.key) {
  houseEdge.init({ projectKey: script.dataset.project, key: script.dataset.key,
    endpoint: script.dataset.endpoint || new URL('/api/collect', script.src).href,
    version: script.dataset.version, respectDoNotTrack: true });
}
(window as unknown as { houseEdge: typeof houseEdge }).houseEdge = houseEdge;
