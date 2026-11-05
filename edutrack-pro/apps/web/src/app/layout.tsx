import type { Metadata, Viewport } from 'next';
import './globals.css';
import { SessionProvider } from '@/lib/session';
import { ToastProvider } from '@/components/ui';

export const metadata: Metadata = {
  title: 'EduTrack Pro — Junior School Management',
  description:
    'EduTrack Pro: competency-based learning records, assessment workflows and timetable planning for Kenyan junior schools.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#12304A',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-KE">
      <body>
        <SessionProvider>
          <ToastProvider>{children}</ToastProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
