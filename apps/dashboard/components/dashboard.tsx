'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowDownToLine, ArrowRight, Bell, BookOpen, CalendarDays, Check, ChevronDown, ChevronRight, Command, Ellipsis, ExternalLink, KeyRound, LoaderCircle, Menu, Plus, Radio, RefreshCw, Search, Settings2, ShieldCheck, Spade, Sparkles, Star, X } from 'lucide-react';
import type { Filters, Overview, Project } from '@house-edge/shared';
import type { GeographyData } from '../../../packages/shared/src/geography';
import type { ViewData } from '@house-edge/engine';
import { navGroups, views } from '@/lib/navigation';
import { Empty, Loading, Modal, ProjectMark } from './ui';
import { OverviewContent } from './overview';
import { AnalyticsView } from './views';
import { ActionForm } from './forms';
import { LoginGeography } from './login-geography';

export type Action = 'project' | 'funnel' | 'feature' | 'alert' | 'release' | 'save' | 'dates' | null;
export function useFetch<T>(url: string | null, revision = 0) {
  const [data, setData] = useState<T | null>(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  const identity = url ? url.split('?')[0] + ':' + new URLSearchParams(url.split('?')[1] || '').get('view') : '';
  const [dataIdentity, setDataIdentity] = useState(identity);
  useEffect(() => {
    if (!url) { setLoading(false); return; }
    const controller = new AbortController(); setLoading(true); setError('');
    fetch(url, { signal: controller.signal }).then(async res => { if (res.status === 401) { location.assign('/login'); throw new Error('Sign in to view your workspace.'); } const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Request failed'); return data; }).then(data => { setData(data); setDataIdentity(identity); setLoading(false); }).catch(e => { if (e.name !== 'AbortError') { setError(e.message); setLoading(false); } });
    return () => controller.abort();
  }, [url, revision]);
  return { data: dataIdentity === identity ? data : null, error, loading };
}
export async function mutate(resource: string, body: unknown) {
  const response = await fetch(`/api/${resource}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Unable to save'); return data;
}
export interface ViewProps {
  view: string; data: ViewData | null; overview: Overview | null; projects: Project[];
  filters: Filters; query: string; paused: boolean; setPaused: (paused: boolean) => void;
  navigate: (view: string, params?: Record<string, string>) => void; action: (action: Action) => void;
  setGeographyDetail: (detail: GeographyData['granularity']) => void;
  refresh: () => void; toast: (message: string) => void; search: string; setSearch: (search: string) => void;
}

export default function Dashboard({ view, demo }: { view: string; demo: boolean }) {
  const router = useRouter(); const params = useSearchParams(); const definition = views[view];
  const [geographyDetail, setGeographyDetail] = useState<GeographyData['granularity']>('country');
  const [revision, setRevision] = useState(0); const [now, setNow] = useState(Date.now());
  const [paused, setPaused] = useState(false); const [mobileOpen, setMobileOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false); const [action, setAction] = useState<Action>(null);
  const [toast, setToast] = useState(''); const [expanded, setExpanded] = useState<string[]>([]);
  const [search, setSearch] = useState(params.get('search') || ''); const [debouncedSearch, setDebouncedSearch] = useState(search);
  const project = params.get('project') || 'all'; const range = params.get('range') || (view === 'heatmap' ? '90d' : view === 'retention' ? '30d' : '7d');
  const refresh = useCallback(() => { setRevision(r => r + 1); setNow(Date.now()); }, []);
  const closeAction = useCallback(() => setAction(null), []);
  const closeCommand = useCallback(() => setCommandOpen(false), []);
  useEffect(() => { setSearch(params.get('search') || ''); }, [params]);
  useEffect(() => { const timer = setTimeout(() => setDebouncedSearch(search), 300); return () => clearTimeout(timer); }, [search]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { if (paused) return; const timer = setInterval(refresh, view === 'live' ? 3000 : 30000); return () => clearInterval(timer); }, [paused, view, refresh]);
  useEffect(() => { const handler = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setCommandOpen(o => !o); } }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, []);
  const filters = useMemo<Filters>(() => {
    const span = ({ realtime: 300000, '1h': 3600000, '24h': 86400000, '7d': 604800000, '30d': 2592000000, '90d': 7776000000 } as Record<string, number>)[range] || 604800000;
    const to = params.get('to') || new Date(now).toISOString();
    const from = params.get('from') || new Date(now - span).toISOString();
    const geographyOptions = view === 'login-geography' ? Object.fromEntries(['environment', 'provider', 'country', 'region', 'success', 'metric', 'minEvents', 'granularity', 'mode'].flatMap(key => { const value = params.get(key); return value && value !== 'auto' ? [[key, key === 'minEvents' ? Number(value) : value]] : []; })) : {};
    return { ...geographyOptions, ...(view === 'login-geography' && (!params.get('granularity') || params.get('granularity') === 'auto') ? { granularity: geographyDetail } : {}), project, from, to, search: debouncedSearch || undefined, event: params.get('event') || undefined, property: params.get('property') || undefined, value: params.get('value') || undefined, minDuration: params.get('minDuration') ? Number(params.get('minDuration')) : undefined };
  }, [project, range, params, now, debouncedSearch, view, geographyDetail]);
  const query = useMemo(() => { const q = new URLSearchParams(); if (view === 'login-geography') for (const key of ['environment', 'provider', 'country', 'region', 'success', 'metric', 'minEvents', 'sample']) { const value = params.get(key); if (value) q.set(key, value); } if (view === 'login-geography' && params.get('granularity') && params.get('granularity') !== 'auto') q.set('granularity', params.get('granularity')!); for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== '') q.set(key, String(value)); return q.toString(); }, [filters, params, view]);
  const overviewQuery = useMemo(() => { const q = new URLSearchParams(query); ['search', 'event', 'property', 'value', 'minDuration'].forEach(k => q.delete(k)); return q.toString(); }, [query]);
  const allProjects = useFetch<Project[]>('/api/projects', revision);
  const overview = useFetch<Overview>(`/api/overview?${overviewQuery}`, revision);
  const isOverview = ['overview', 'projects', 'snapshot', 'health', 'pulse', 'compare'].includes(view);
  const dataset = useFetch<ViewData>(!isOverview && view !== 'docs' && view !== 'login-geography' ? `/api/data?view=${view}&${query}&interval=${params.get('interval') || 'weekly'}&offset=${params.get('offset') || '0'}` : null, revision);
  const navigate = useCallback((target: string, overrides: Record<string, string> = {}) => {
    const q = new URLSearchParams();
    for (const key of ['project', 'range', 'from', 'to']) { const value = params.get(key); if (value) q.set(key, value); }
    if (target === 'login-geography') for (const key of ['environment', 'provider', 'country', 'region', 'success', 'metric', 'minEvents', 'granularity', 'mode', 'sample']) { const value = params.get(key); if (value) q.set(key, value); }
    for (const [key, value] of Object.entries(overrides)) { if (value) q.set(key, value); else q.delete(key); }
    router.push(`${target === 'overview' ? '/' : `/${target}`}${q.size ? `?${q}` : ''}`); setMobileOpen(false);
  }, [params, router]);
  const selectedProject = allProjects.data?.find(p => p.id === project);
  const error = overview.error || dataset.error || allProjects.error;
  const props: ViewProps = { view, data: dataset.data, overview: overview.data, projects: allProjects.data || [], filters, query, paused, setPaused: p => { setPaused(p); if (!p) refresh(); }, navigate, action: setAction, refresh, toast: setToast, search, setSearch, setGeographyDetail };
  const navigationQuery = new URLSearchParams();
  for (const name of ['project', 'range', 'from', 'to']) { const value = params.get(name); if (value) navigationQuery.set(name, value); }
  const navItem = (key: string) => { const item = views[key]; const Icon = item.icon; return <Link key={key} href={`/${key === 'overview' ? '' : key}${navigationQuery.size ? `?${navigationQuery}` : ''}`} onClick={() => setMobileOpen(false)} className={`nav-item ${view === key ? 'active' : ''}`}><Icon size={16} strokeWidth={1.7} /><span>{key === 'events' ? 'Events' : key === 'sessions' ? 'Sessions' : item.title}</span>{key === 'live' && <span className="live-dot" />}{key === 'projects' && allProjects.data && <span className="nav-count">{allProjects.data.length}</span>}{key === 'pulse' && <span className="new-label">NEW</span>}</Link>; };
  return <div className="app-shell">
    {mobileOpen && <div className="sidebar-scrim" onClick={() => setMobileOpen(false)} />}
    <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
      <Link href="/" className="brand"><span className="brand-mark"><Spade size={24} fill="currentColor" strokeWidth={1.4} /></span><span>HOUSE EDGE<span className="brand-caption">THE HOUSE SEES EVERYTHING.</span></span></Link>
      <button className="workspace-switch" onClick={() => navigate('settings')}><span className="workspace-avatar">RL</span><span>Rippley workspace<small>Personal workspace</small></span><ChevronDown size={14} /></button>
      <button className="sidebar-search" onClick={() => setCommandOpen(true)}><Search size={14} /><span>Search anything…</span><kbd>⌘ K</kbd></button>
      <nav aria-label="Main navigation" className="nav-scroll">{navGroups.map(group => <div className="nav-group" key={group.title}>{group.title && <div className="nav-group-label"><span>{group.title}</span>{group.more && <button className="nav-more" aria-label={`More ${group.title.toLowerCase()} views`} onClick={() => setExpanded(a => a.includes(group.title) ? a.filter(x => x !== group.title) : [...a, group.title])}><Ellipsis size={14} /></button>}</div>}{group.items.map(navItem)}{group.more && (expanded.includes(group.title) || group.more.includes(view)) && group.more.map(navItem)}</div>)}</nav>
      <div className="sidebar-bottom"><button className={`nav-item ${view === 'keys' ? 'active' : ''}`} onClick={() => navigate('keys')}><KeyRound size={16} /><span>Projects & API Keys</span></button><div className="sidebar-bottom-row"><button className="nav-item" onClick={() => navigate('settings')}><Settings2 size={16} />Settings</button><button className="icon-button" aria-label="Integration guide" onClick={() => navigate('docs')}><BookOpen size={16} /></button></div><div className="sidebar-status"><span className={`status-dot ${error ? 'warning' : ''}`} /><span>{error ? 'Connection interrupted' : 'All systems operational'}</span><span className="version">v0.1</span></div></div>
    </aside>
    <div className="workspace-main"><header className="topbar"><div className="breadcrumbs"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={20} /></button><span className="workspace-breadcrumb">Workspace</span><ChevronRight size={13} /><span>{definition.title}</span></div><div className="topbar-right">{demo && <span className="demo-tag"><span />Demo workspace</span>}<button className="header-live" onClick={() => navigate('live')}><span className="live-dot" />{overview.data?.activeUsers ?? '—'} online now</button><span className="topbar-separator" /><button className="icon-button" aria-label="Search workspace" onClick={() => setCommandOpen(true)}><Search size={17} /></button><button className="icon-button notification-button" aria-label="View alerts" onClick={() => navigate('alerts')}><Bell size={17} /></button><button className="profile-avatar" aria-label="Workspace settings" onClick={() => navigate('settings')}>AR</button></div></header>
      <main className="main-content"><div className="page-heading"><div><div className="eyebrow">{view === 'overview' ? 'YOUR ECOSYSTEM, AT A GLANCE' : definition.group || 'IN THE MOMENT'}</div><h1>{view === 'projects' && selectedProject ? selectedProject.name : definition.title}{view === 'live' && <span className="live-label"><span className="live-dot" />LIVE</span>}</h1><p>{view === 'projects' && selectedProject ? `${selectedProject.domain} · ${selectedProject.environment}` : definition.subtitle}</p></div><div className="heading-actions">{view !== 'docs' && <button className="icon-button refresh-button" aria-label="Refresh analytics" onClick={refresh}><RefreshCw size={16} className={overview.loading && overview.data ? 'spin' : ''} /></button>}<button className="button primary" onClick={() => setAction(view === 'funnels' ? 'funnel' : view === 'features' ? 'feature' : view === 'alerts' ? 'alert' : view === 'releases' ? 'release' : 'project')}><Plus size={16} />{view === 'funnels' ? 'Create funnel' : view === 'features' ? 'Track feature' : view === 'alerts' ? 'Create alert' : view === 'releases' ? 'Add release' : 'Add project'}</button></div></div>
        {!['settings', 'keys', 'docs', 'saved', 'alerts'].includes(view) && <div className="filter-bar"><div className="filter-left"><label className="select-button project-select"><span className="filter-project-icon">{selectedProject ? <ProjectMark small name={selectedProject.name} color={selectedProject.color} /> : <span className="four-grid"><i /><i /><i /><i /></span>}</span><select aria-label="Filter by project" value={project} onChange={e => navigate(view, { project: e.target.value })}><option value="all">All projects</option>{allProjects.data?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><ChevronDown size={13} /></label><span className="filter-divider" /><label className="select-button"><CalendarDays size={14} /><select aria-label="Date range" value={range} onChange={e => e.target.value === 'custom' ? setAction('dates') : navigate(view, { range: e.target.value, from: '', to: '' })}><option value="realtime">Realtime</option><option value="1h">Last hour</option><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="90d">Last 90 days</option><option value="custom">Custom range</option></select><ChevronDown size={13} /></label><span className="filter-date">{new Date(filters.from).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}<span>—</span>{new Date(filters.to).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}</span></div><div className="filter-right"><span className="comparison-note">vs. previous period</span><button className="icon-button" aria-label="Save current view" disabled={view === 'login-geography' && params.get('sample') === 'true'} onClick={() => setAction('save')}><Star size={15} /></button><button className="icon-button" aria-label="Export CSV" disabled={view === 'login-geography' && params.get('sample') === 'true'} onClick={async () => { try { const response = await fetch(`/api/export?view=${isOverview ? 'events' : view}&${query}`); if (!response.ok) throw new Error('Export failed'); const url = URL.createObjectURL(await response.blob()); const a = document.createElement('a'); a.href = url; a.download = `house-edge-${view}.csv`; a.click(); URL.revokeObjectURL(url); setToast(view === 'login-geography' ? 'Aggregated login locations exported.' : 'CSV exported. Event exports include the latest 100 matching events.'); } catch (e) { setToast((e as Error).message); } }}><ArrowDownToLine size={15} /></button></div></div>}
        {error ? <div className="error-banner" role="alert"><ShieldCheck size={20} /><div><strong>We couldn’t reach your data.</strong><p>{error}</p></div><button className="button" onClick={refresh}>Try again</button></div> : !overview.data && view !== 'docs' && view !== 'login-geography' ? <Loading /> : <div className="view-content" key={view}>{view === 'login-geography' ? <LoginGeography {...props} /> : view === 'overview' || view === 'snapshot' || view === 'projects' && selectedProject ? <OverviewContent {...props} /> : <AnalyticsView {...props} />}</div>}
        <footer className="page-footer"><span><Spade size={12} fill="currentColor" />HOUSE EDGE<span className="footer-divider">/</span>The house sees everything.</span><span>{demo ? 'Demo data · real analytics queries' : 'Privacy first · your data stays yours'}<span className="footer-divider">·</span>All times UTC</span></footer>
      </main>
    </div>
    {commandOpen && <CommandPalette projects={allProjects.data || []} onClose={closeCommand} navigate={navigate} />}
    {action && <ActionForm action={action} onClose={closeAction} projects={allProjects.data || []} project={project} view={view} filters={filters} onSuccess={message => { refresh(); setToast(message); }} navigate={navigate} />}
    {toast && <div className="toast" role="status"><Check size={16} /><span>{toast}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast('')}><X size={14} /></button></div>}
  </div>;
}

function CommandPalette({ projects, onClose, navigate }: { projects: Project[]; onClose: () => void; navigate: ViewProps['navigate'] }) {
  const [search, setSearch] = useState(''); const normalized = search.toLowerCase();
  const matchingViews = Object.entries(views).filter(([, v]) => `${v.title} ${v.subtitle}`.toLowerCase().includes(normalized)).slice(0, 6);
  const matchingProjects = projects.filter(p => `${p.name} ${p.project_key}`.toLowerCase().includes(normalized)).slice(0, 5);
  const go = (view: string, p?: Record<string, string>) => { navigate(view, p); onClose(); };
  const smartSearch = () => {
    const longSession = normalized.match(/sessions.*?(\d+)\s*min/);
    if (longSession) go('sessions', { minDuration: String(Number(longSession[1]) * 60000) });
    else if (normalized.includes('errors today')) go('errors', { range: '24h', from: '', to: '' });
    else if (normalized.includes('github')) go('sessions', { search: 'github.com' });
    else go('events', { search });
  };
  return <Modal title="Search your workspace" onClose={onClose}><div className="command-input"><Search size={20} /><input autoFocus placeholder="Projects, events, sessions, releases…" value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && search) smartSearch(); }} /><kbd>ESC</kbd></div><div className="command-results">{matchingProjects.length > 0 && <div className="command-label">PROJECTS</div>}{matchingProjects.map(p => <button key={p.id} onClick={() => go('projects', { project: p.id })}><ProjectMark small name={p.name} color={p.color} /><span>{p.name}<small>{p.domain}</small></span><ArrowRight size={15} /></button>)}{matchingViews.length > 0 && <div className="command-label">PAGES & TOOLS</div>}{matchingViews.map(([key, v]) => <button key={key} onClick={() => go(key)}><v.icon size={17} /><span>{v.title}</span><ArrowRight size={15} /></button>)}{search && <button className="command-search-all" onClick={smartSearch}><Search size={17} /><span>Search analytics for “{search}”</span><kbd>↵</kbd></button>}</div><p className="command-hint">Try “errors today”, “sessions longer than 10 minutes”, or an event name.</p></Modal>;
}
