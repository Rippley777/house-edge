'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  Copy,
  Database,
  Download,
  LoaderCircle,
  Search,
  X,
} from 'lucide-react';
import { duration, number } from '@house-edge/shared';

export function Delta({ value, inverse = false, baseline }: { value: number; inverse?: boolean; baseline?: number }) {
  if (baseline === 0 && value !== 0)
    return (
      <span className="delta" title="No previous-period baseline">
        New
      </span>
    );
  const positive = inverse ? value <= 0 : value >= 0;
  return (
    <span className={`delta ${positive ? 'positive' : 'negative'}`}>
      {value >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
      {Math.abs(value).toFixed(1).replace('.0', '')}%
    </span>
  );
}
export function ProjectMark({ name, color = '#6fc9a5', small }: { name: string; color?: string; small?: boolean }) {
  const letters = name
    .split(/[ -]/)
    .map((s) => s[0])
    .slice(0, 2)
    .join('');
  return (
    <span
      className={`project-mark ${small ? 'small' : ''}`}
      style={{ color, background: `${color}13`, borderColor: `${color}25` }}
    >
      {letters}
    </span>
  );
}
export function Empty({
  title = 'No activity in this view',
  description = 'Try a different date range or connect an application to start collecting events.',
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Database size={25} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Loading({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? 'inline-loading' : 'loading-state'} role="status">
      <LoaderCircle size={20} className="spin" />
      <span>Reading the room…</span>
    </div>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const old = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focus = () =>
      (
        ref.current?.querySelector<HTMLElement>('input, select, textarea') ||
        ref.current?.querySelector<HTMLElement>('button, a[href]')
      )?.focus();
    focus();
    const keydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const items = ref.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input, select, textarea, a[href], [tabindex="0"]',
        );
        if (!items?.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.body.style.overflow = old;
      document.removeEventListener('keydown', keydown);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`modal ${wide ? 'wide' : ''}`}>
        <div className="modal-header">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
export function CodeBlock({ code, language = 'typescript' }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  return (
    <div className="code-block">
      <div className="code-header">
        <span>{language}</span>
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              setError(true);
            }
          }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
      {error && <p className="fine-print">Clipboard unavailable. Select and copy the code above.</p>}
    </div>
  );
}
export interface Column {
  key: string;
  label: string;
  render?: (row: Record<string, string | number | null>) => ReactNode;
  align?: 'right';
}
export function DataTable({
  rows,
  columns,
  onRow,
  empty,
  foot,
}: {
  rows: Record<string, string | number | null>[];
  columns: Column[];
  onRow?: (row: Record<string, string | number | null>) => void;
  empty?: ReactNode;
  foot?: ReactNode;
}) {
  if (!rows.length) return <>{empty || <Empty />}</>;
  return (
    <>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={c.align === 'right' ? 'align-right' : ''}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={String(r.id || r.session_id || r.anonymous_id || i) + i}
                onClick={onRow ? () => onRow(r) : undefined}
                onKeyDown={
                  onRow
                    ? (e) => {
                        if (e.key === 'Enter') onRow(r);
                      }
                    : undefined
                }
                tabIndex={onRow ? 0 : undefined}
                className={onRow ? 'clickable' : ''}
              >
                {columns.map((c) => (
                  <td key={c.key} className={c.align === 'right' ? 'align-right' : ''}>
                    {c.render ? c.render(r) : r[c.key] == null ? <span className="muted">—</span> : String(r[c.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {foot && <div className="table-footer">{foot}</div>}
    </>
  );
}
export function Panel({
  title,
  subtitle,
  action,
  children,
  className = '',
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <div className="panel-header">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
export function relativeTime(value: string) {
  const seconds = Math.max(0, (Date.now() - Date.parse(value)) / 1000);
  return seconds < 60
    ? `${Math.floor(seconds)}s ago`
    : seconds < 3600
      ? `${Math.floor(seconds / 60)}m ago`
      : seconds < 86400
        ? `${Math.floor(seconds / 3600)}h ago`
        : `${Math.floor(seconds / 86400)}d ago`;
}
export function time(value: string) {
  return new Date(value).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'UTC',
  });
}
export function date(value: string) {
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
export { number, duration };
