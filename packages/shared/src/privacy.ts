/** Conservative text scrubbing, shared with the dependency-free browser bundle. */
export function scrubText(value: string): string {
  return value
    .replace(/https?:\/\/[^\s<>"')]+/gi, (input) => {
      try {
        const url = new URL(input);
        return url.origin + url.pathname;
      } catch {
        return '[url]';
      }
    })
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip]')
    .replace(/\b(?:[a-f0-9]{0,4}:){2,}[a-f0-9:]{0,39}\b/gi, '[ip]')
    .replace(/\b(Bearer\s+)\S+/gi, '$1[redacted]')
    .replace(/\b(password|passwd|secret|token|api[_-]?key|authorization|cookie)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .slice(0, 2048);
}
export function errorSignature(value: string): string {
  return scrubText(value)
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '[id]')
    .replace(/\b[0-9a-f]{16,}\b/gi, '[id]')
    .replace(/\b\d+\b/g, '#');
}
export function referrerOrigin(input?: string): string {
  if (!input) return '';
  try {
    const url = new URL(input);
    return ['http:', 'https:'].includes(url.protocol) ? url.origin : '';
  } catch {
    return '';
  }
}
