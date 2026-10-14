import type { Metadata } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import './globals.css';

const sans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
});
const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'ALX Ops Board',
  description: 'AirportLabs live operations board',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      {/* Browser extensions (e.g. ColorZilla's `cz-shortcut-listen`) add attributes to
          <body> before React hydrates. This ignores <body>'s own attributes only;
          mismatches anywhere inside it are still reported. */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
