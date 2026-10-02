import ipaddr from 'ipaddr.js';
import { timingSafeEqual } from 'node:crypto';

export function normalizeIp(value?: string | null): string | null {
  if (!value || value.length > 64 || value.includes('%')) return null;
  let input = value.trim();
  if (/^\[[\da-f:]+\](?::\d+)?$/i.test(input)) input = input.slice(1, input.indexOf(']'));
  if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(input)) input = input.slice(0, input.lastIndexOf(':'));
  // Reject abbreviated, octal, and hexadecimal IPv4 forms.
  if (
    !input.includes(':') &&
    (!/^\d{1,3}(\.\d{1,3}){3}$/.test(input) || input.split('.').some((p) => p.length > 1 && p.startsWith('0')))
  )
    return null;
  try {
    return ipaddr.process(input).toString();
  } catch {
    return null;
  }
}
export function publicIp(value?: string | null): string | null {
  const ip = normalizeIp(value);
  if (!ip) return null;
  const address = ipaddr.parse(ip);
  return address.range() === 'unicast' ? ip : null;
}
export function inCidrs(value: string | null, cidrs: string[]): boolean {
  if (!value) return false;
  try {
    const ip = ipaddr.process(value);
    return cidrs.some((cidr) => {
      try {
        const [network, bits] = ipaddr.parseCIDR(cidr);
        return network.kind() === ip.kind() && ip.match(network, bits);
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}
export interface IpTrust {
  remoteAddress?: string;
  trustedCidrs?: string[];
  cloudflareCidrs?: string[];
  ingressSecret?: string;
  cloudflareIngress?: boolean;
}
export function extractClientNetwork(
  headers: Headers,
  trust: IpTrust = {},
): { ip: string | null; country: string | null } {
  const peer = normalizeIp(trust.remoteAddress);
  const supplied = headers.get('x-house-edge-ingress-token') || '';
  const secret = trust.ingressSecret || '';
  const authenticatedIngress =
    secret.length >= 32 &&
    Buffer.byteLength(supplied) === Buffer.byteLength(secret) &&
    timingSafeEqual(Buffer.from(supplied), Buffer.from(secret));
  const trusted =
    authenticatedIngress || inCidrs(peer, trust.trustedCidrs || []) || inCidrs(peer, trust.cloudflareCidrs || []);
  const cloudflare =
    trusted && (inCidrs(peer, trust.cloudflareCidrs || []) || (authenticatedIngress && trust.cloudflareIngress));
  if (!trusted) return { ip: publicIp(peer), country: null };
  const country =
    cloudflare &&
    /^[A-Z]{2}$/.test(headers.get('cf-ipcountry') || '') &&
    !['XX', 'T1'].includes(headers.get('cf-ipcountry')!)
      ? headers.get('cf-ipcountry')
      : null;
  if (cloudflare) {
    const ip = publicIp(headers.get('cf-connecting-ip'));
    if (ip) return { ip, country };
  }
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const hops = forwarded.split(',');
    if (hops.length > 32) return { ip: null, country };
    // Peel the trusted chain from the right. Never accept spoofed entries to the left of the client.
    for (let i = hops.length - 1; i >= 0; i--) {
      const hop = normalizeIp(hops[i]);
      if (!hop) return { ip: null, country };
      if (inCidrs(hop, trust.trustedCidrs || []) || inCidrs(hop, trust.cloudflareCidrs || [])) continue;
      return { ip: publicIp(hop), country };
    }
    return { ip: null, country };
  }
  return { ip: publicIp(peer), country };
}
export function requestNetwork(request: Request, remoteAddress?: string) {
  return extractClientNetwork(request.headers, {
    remoteAddress,
    trustedCidrs: (process.env.GEO_TRUSTED_PROXY_CIDRS || '').split(',').filter(Boolean),
    cloudflareCidrs: (process.env.GEO_CLOUDFLARE_CIDRS || '').split(',').filter(Boolean),
    ingressSecret: process.env.GEO_INGRESS_SECRET,
    cloudflareIngress: process.env.GEO_CLOUDFLARE_INGRESS === 'true',
  });
}
