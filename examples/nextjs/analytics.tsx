'use client';
import { useEffect } from 'react';
import { houseEdge } from '@house-edge/analytics';
export function Analytics() {
  useEffect(() => {
    houseEdge.init({
      projectKey: 'repo-reaper',
      key: process.env.NEXT_PUBLIC_HOUSE_EDGE_KEY!,
      endpoint: process.env.NEXT_PUBLIC_HOUSE_EDGE_URL + '/api/collect',
      version: process.env.NEXT_PUBLIC_APP_VERSION,
      blockedProperties: ['customer_name'],
    });
    return () => houseEdge.destroy();
  }, []);
  return null;
}
