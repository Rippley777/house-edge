'use client';
import { useState } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  ChevronRight,
  Clock3,
  Code2,
  ExternalLink,
  GitBranch,
  Globe,
  MousePointer2,
  Radio,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingUp,
  Users,
} from 'lucide-react';
import { change, type EventRow, type ProjectMetrics } from '@house-edge/shared';
import type { ViewProps } from './dashboard';
import { Delta, Empty, Panel, ProjectMark, date, duration, number, relativeTime, time } from './ui';
import { EcosystemChart, Sparkline } from './charts';
import { EventInspector } from './inspectors';

export function OverviewContent(props: ViewProps) {
  const { overview: data, navigate, action } = props;
  const [selected, setSelected] = useState<EventRow | null>(null);
  if (!data) return null;
  const conversion = data.current.sessions ? (data.current.conversions / data.current.sessions) * 100 : 0;
  const previousConversion = data.previous.sessions ? (data.previous.conversions / data.previous.sessions) * 100 : 0;
  const metrics = [
    {
      label: 'Total visitors',
      value: number(data.current.users),
      delta: change(data.current.users, data.previous.users),
      baseline: data.previous.users,
      icon: Users,
      values: data.series.map((p) => p.users),
      sub: 'unique visitors',
      color: '#70cfa8',
    },
    {
      label: 'Sessions',
      value: number(data.current.sessions),
      delta: change(data.current.sessions, data.previous.sessions),
      baseline: data.previous.sessions,
      icon: MousePointer2,
      values: data.series.map((p) => p.sessions),
      sub: 'sessions started',
      color: '#8aaff1',
    },
    {
      label: 'Total events',
      value: number(data.current.events),
      delta: change(data.current.events, data.previous.events),
      baseline: data.previous.events,
      icon: Activity,
      values: data.series.map((p) => p.events),
      sub: 'events captured',
      color: '#b19be1',
    },
    {
      label: 'Conversion rate',
      value: `${conversion.toFixed(1)}%`,
      delta: change(conversion, previousConversion),
      baseline: previousConversion,
      icon: Target,
      values: data.series.map((p) => (p.sessions ? (p.conversions / p.sessions) * 100 : 0)),
      sub: `${number(data.current.conversions)} conversions`,
      color: '#d0b777',
    },
  ];
  return (
    <>
      {props.view === 'snapshot' && (
        <div className="info-banner">
          <Clock3 size={17} />
          <span>
            Historical data through{' '}
            <strong>{new Date(props.filters.to).toLocaleString('en-US', { timeZone: 'UTC' })} UTC</strong>. Use a custom
            date range to visit another day.
          </span>
          <button className="text-button" onClick={() => action('dates')}>
            Choose date <ArrowRight size={14} />
          </button>
        </div>
      )}
      <div className="metric-grid">
        {metrics.map((m) => (
          <div className="metric-card" key={m.label}>
            <div className="metric-label">
              <span>{m.label}</span>
              <m.icon size={15} />
            </div>
            <div className="metric-value">{m.value}</div>
            <div className="metric-bottom">
              <Delta value={m.delta} baseline={m.baseline} />
              <span>vs. previous period</span>
            </div>
            <Sparkline values={m.values} color={m.color} />
          </div>
        ))}
      </div>
      <div className="secondary-metrics">
        <div>
          <span className="live-dot" />
          <strong>{data.activeUsers}</strong>
          <span>active now</span>
        </div>
        <span className="secondary-divider" />
        <div>
          <Globe size={13} />
          <strong>{number(data.current.pageViews)}</strong>
          <span>page views</span>
        </div>
        <span className="secondary-divider" />
        <div>
          <Clock3 size={13} />
          <strong>{duration(data.current.avgDuration)}</strong>
          <span>avg. session</span>
        </div>
        <span className="secondary-divider" />
        <button onClick={() => navigate('errors')}>
          <ShieldAlert size={13} />
          <strong className={data.current.errors ? 'text-amber' : ''}>{number(data.current.errors)}</strong>
          <span>errors</span>
          <ChevronRight size={12} />
        </button>
        <span className="secondary-divider" />
        <div>
          <span className="project-count-dot" />
          <strong>{data.projects.length}</strong>
          <span>active projects</span>
        </div>
      </div>
      {props.view === 'projects' && data.projects[0] && (
        <div className="project-detail-signals">
          <Panel title="Visitor retention" subtitle="Previous-period visitors who returned">
            <strong>{data.projects[0].retentionRate.toFixed(1)}%</strong>
            <Delta value={data.projects[0].retentionChange} />
            <button className="text-button" onClick={() => navigate('retention')}>
              Explore cohorts <ArrowRight size={13} />
            </button>
          </Panel>
          <Panel title="P95 timing" subtitle="Across recorded performance samples">
            <strong>{duration(data.projects[0].p95Latency)}</strong>
            <Delta value={data.projects[0].performanceChange} inverse />
            <button className="text-button" onClick={() => navigate('performance')}>
              Explore performance <ArrowRight size={13} />
            </button>
          </Panel>
          <Panel title="Project health" subtitle="Independent signals, no arbitrary score">
            <strong>
              {data.projects[0].errorRate.toFixed(2)}%<small>of events are errors</small>
            </strong>
            <Delta value={data.projects[0].errorChange} inverse />
            <button className="text-button" onClick={() => navigate('health')}>
              View all indicators <ArrowRight size={13} />
            </button>
          </Panel>
        </div>
      )}
      <div className="overview-middle">
        <EcosystemChart data={data} />
        <Panel
          className="pulse-panel"
          title="House Edge Pulse"
          subtitle="The signals worth your attention."
          action={
            <span className="pulse-icon">
              <Sparkles size={17} />
            </span>
          }
        >
          <div className="pulse-items">
            {data.insights.slice(0, 3).map((insight, i) => (
              <button
                className="pulse-item"
                key={insight.id}
                onClick={() =>
                  navigate(insight.metric === 'errors' ? 'errors' : 'projects', { project: insight.projectId })
                }
              >
                <span className={`insight-icon ${insight.kind}`}>
                  {insight.kind === 'positive' ? (
                    <TrendingUp size={15} />
                  ) : insight.kind === 'warning' ? (
                    <ShieldAlert size={15} />
                  ) : (
                    <Activity size={15} />
                  )}
                </span>
                <span>
                  <strong>{insight.title}</strong>
                  <small>{insight.detail}</small>
                </span>
                <ChevronRight size={13} />
              </button>
            ))}
            {!data.insights.length && (
              <Empty title="Waiting for a signal" description="Your first events will bring this view to life." />
            )}
          </div>
          <button className="pulse-footer" onClick={() => navigate('pulse')}>
            <span>Explore all insights</span>
            <ArrowRight size={15} />
          </button>
          <span className="pulse-watermark">♠</span>
        </Panel>
      </div>
      <div className="overview-bottom">
        <Panel
          title="Your projects"
          subtitle="Different applications. One clear picture."
          action={
            <button className="text-button" onClick={() => navigate('projects', { project: 'all' })}>
              View all projects <ArrowRight size={14} />
            </button>
          }
        >
          <ProjectTable projects={data.projects} navigate={navigate} />
          <div className="project-table-footer">
            <span>
              <span className="status-dot" />
              {data.projects.length} projects connected
            </span>
            <button className="text-button" onClick={() => action('project')}>
              <span>+</span> Connect a project
            </button>
          </div>
        </Panel>
        <Panel
          title="Live activity"
          subtitle="The latest from across the ecosystem."
          action={
            <span className="live-label">
              <span className="live-dot" />
              LIVE
            </span>
          }
          className="recent-panel"
        >
          <div className="recent-list">
            {data.recent.slice(0, 6).map((event) => (
              <button key={event.id} className="recent-item" onClick={() => setSelected(event)}>
                <ProjectMark small name={event.project_name || ''} color={event.color} />
                <span className="recent-event">
                  <strong>{event.event_name}</strong>
                  <small>
                    {event.project_name}
                    <span>·</span>
                    {event.path || '/'}
                  </small>
                </span>
                <span className="recent-time">{relativeTime(event.timestamp)}</span>
              </button>
            ))}
            {!data.recent.length && <Empty />}
          </div>
          <button className="panel-link-footer" onClick={() => navigate('live')}>
            Watch the live feed <ArrowRight size={14} />
          </button>
        </Panel>
      </div>
      {data.traffic && (
        <>
          <div className="secondary-metrics">
            <span>
              <strong>{number(data.traffic.newVisitors)}</strong> new visitors
            </span>
            <span>
              <strong>{number(data.traffic.returningVisitors)}</strong> returning visitors · based on retained anonymous
              history
            </span>
          </div>
          <div className="overview-bottom">
            {(
              [
                ['Top pages', data.traffic.pages],
                ['Referring origins', data.traffic.referrers],
                ['Devices', data.traffic.devices],
                ['Browsers', data.traffic.browsers],
              ] as const
            ).map(([title, rows]) => (
              <Panel key={title} title={title} subtitle="Page views · top 20 in the selected period">
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{title}</th>
                        <th className="align-right">Page views</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.label}>
                          <td>{row.label || 'Direct / unknown'}</td>
                          <td className="align-right">{number(row.count)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!rows.length && <Empty />}
                </div>
              </Panel>
            ))}
          </div>
        </>
      )}
      {data.deployments.length > 0 && (
        <div className="deployment-strip">
          <span className="deploy-icon">
            <GitBranch size={15} />
          </span>
          <span>
            <strong>Latest release</strong>
            <span>{data.deployments[0].project_name}</span>
            <code>v{data.deployments[0].version}</code>
            <span className="muted">{date(data.deployments[0].deployed_at)}</span>
          </span>
          <button className="text-button" onClick={() => navigate('releases')}>
            See what changed <ArrowRight size={13} />
          </button>
        </div>
      )}
      {selected && <EventInspector event={selected} onClose={() => setSelected(null)} navigate={navigate} />}
    </>
  );
}

export function ProjectTable({ projects, navigate }: { projects: ProjectMetrics[]; navigate: ViewProps['navigate'] }) {
  const maximum = Math.max(1, ...projects.map((p) => p.events));
  if (!projects.length)
    return (
      <Empty
        title="Your ecosystem starts here"
        description="Connect your first application to see visitors, events, and errors in one place."
      />
    );
  return (
    <div className="table-scroll">
      <table className="data-table project-table">
        <thead>
          <tr>
            <th>Project</th>
            <th className="align-right">Visitors</th>
            <th className="align-right">Events</th>
            <th>Traffic</th>
            <th className="align-right">Change</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => (
            <tr
              key={project.id}
              className="clickable"
              onClick={() => navigate('projects', { project: project.id })}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter') navigate('projects', { project: project.id });
              }}
            >
              <td>
                <div className="project-name">
                  <ProjectMark name={project.name} color={project.color} />
                  <span>
                    <strong>{project.name}</strong>
                    <small>{project.domain}</small>
                  </span>
                </div>
              </td>
              <td className="align-right tabular">{number(project.users)}</td>
              <td className="align-right tabular">{number(project.events)}</td>
              <td>
                <div className="traffic-track">
                  <span
                    style={{
                      width: `${Math.max(2, (project.events / maximum) * 100)}%`,
                      backgroundColor: project.color,
                    }}
                  />
                </div>
              </td>
              <td className="align-right">
                <Delta value={project.change} baseline={project.previousUsers} />
              </td>
              <td>
                <ChevronRight size={14} className="muted" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
