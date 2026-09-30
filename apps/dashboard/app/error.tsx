'use client';
export default function ErrorPage({ reset }: { reset: () => void }) { return <main className="login-page"><div className="empty-state"><h1>Something interrupted the view.</h1><p>Your data is still in the database. Try loading this page again.</p><button className="button primary" onClick={reset}>Try again</button></div></main>; }
