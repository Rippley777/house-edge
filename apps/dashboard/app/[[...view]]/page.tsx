import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { isDemo } from '@house-edge/database';
import { COOKIE, verifySession } from '@/lib/auth';
import Dashboard from '@/components/dashboard';
import { views } from '@/lib/navigation';

export const dynamic = 'force-dynamic';
export default async function Page({ params }: { params: Promise<{ view?: string[] }> }) {
  const { view: segments } = await params;
  const view = segments?.[0] || 'overview';
  if (segments && segments.length > 1 || !views[view]) notFound();
  if (!isDemo() && !verifySession((await cookies()).get(COOKIE)?.value)) redirect('/login');
  return <Dashboard view={view} demo={isDemo()} />;
}
