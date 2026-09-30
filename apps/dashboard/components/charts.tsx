'use client';
import { useId, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, ArrowUpRight, ChevronDown, GitBranch, Users } from 'lucide-react';
import type { Overview, SeriesPoint } from '@house-edge/shared';
import { number, Panel } from './ui';

export function Sparkline({ values, color = '#62d4a6' }: { values: number[]; color?: string }) {
  const id = useId().replaceAll(':', '');
  if (values.length < 2) return <span className="sparkline-placeholder" />;
  const max = Math.max(...values, 1); const min = Math.min(...values, 0);
  const points = values.map((v, i) => `${i / (values.length - 1) * 110},${37 - (v - min) / (max - min || 1) * 30}`).join(' ');
  return <svg className="sparkline" viewBox="0 0 110 42" aria-hidden="true"><defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".16" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs><polygon points={`0,42 ${points} 110,42`} fill={`url(#${id})`} /><polyline points={points} fill="none" stroke={color} strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}
export function EcosystemChart({ data }: { data: Overview }) {
  const [metric, setMetric] = useState<'users' | 'events' | 'sessions'>('users');
  const id = useId().replaceAll(':', '');
  const rows = data.series.map((p, i) => ({ ...p, label: p.date.length > 10 ? `${p.date.slice(11)}:00` : new Date(`${p.date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), previous: data.previousSeries[i]?.[metric] || 0 }));
  const deployments = new Set(data.deployments.map(d => d.deployed_at.slice(0, 10)));
  return <Panel className="activity-panel" title="Ecosystem activity" subtitle="A little perspective on the big picture." action={<div className="segmented">{(['users', 'events', 'sessions'] as const).map(m => <button key={m} className={metric === m ? 'selected' : ''} onClick={() => setMetric(m)}>{m === 'users' ? 'Visitors' : m === 'events' ? 'Events' : 'Sessions'}</button>)}</div>}>
    <div className="chart-legend"><span><i className="legend-dot green" />Current period</span><span><i className="legend-dot gray" />Previous period</span><span className="chart-total">{number(data.current[metric])}<small>{metric === 'users' ? 'unique visitors' : metric}</small></span></div>
    <div className="main-chart" role="img" aria-label={`${metric} over time. ${number(data.current[metric])} in the selected period.`}>
      <ResponsiveContainer width="100%" height="100%"><AreaChart data={rows} margin={{ top: 16, right: 12, left: -17, bottom: 0 }}><defs><linearGradient id={`area-${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#54c79a" stopOpacity={.23} /><stop offset="100%" stopColor="#54c79a" stopOpacity={.015} /></linearGradient></defs><CartesianGrid stroke="#252a2b" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#7d8585', fontSize: 10 }} minTickGap={30} dy={10} /><YAxis axisLine={false} tickLine={false} tick={{ fill: '#707979', fontSize: 10 }} tickFormatter={number} tickCount={5} /><Tooltip contentStyle={{ background: '#1a201e', border: '1px solid #35413b', borderRadius: 8, fontSize: 12 }} labelStyle={{ color: '#a8b3ac', marginBottom: 8 }} formatter={(value, name) => [Number(value).toLocaleString(), name === 'previous' ? 'Previous period' : 'Current period']} /><Area type="monotone" dataKey="previous" stroke="#535c5a" strokeDasharray="4 5" fill="transparent" strokeWidth={1.5} isAnimationActive={false} /><Area type="monotone" dataKey={metric} stroke="#67d5a8" fill={`url(#area-${id})`} strokeWidth={2.3} animationDuration={700} />{rows.filter(p => deployments.has(p.date.slice(0, 10))).slice(-2).map(p => <ReferenceLine key={p.date} x={p.label} stroke="#c5b07b" strokeOpacity={.4} strokeDasharray="3 4" />)}</AreaChart></ResponsiveContainer>
    </div><div className="chart-caption"><span><GitBranch size={12} />Gold markers indicate deployments</span><span>UTC · {data.series.length} data points</span></div>
  </Panel>;
}
