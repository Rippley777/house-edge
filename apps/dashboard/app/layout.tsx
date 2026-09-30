import type { Metadata } from 'next';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/jetbrains-mono/400.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'House Edge — Your software, in sight.',
  description: 'One dashboard. Every application. Every event. Analytics and observability for your entire ecosystem.',
  icons: { icon: '/icon.svg' },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
