import Link from 'next/link';
export default function NotFound() { return <main className="login-page"><div className="empty-state"><h1>This table is empty.</h1><p>We couldn’t find that page.</p><Link className="button primary" href="/">Back to Overview</Link></div></main>; }
