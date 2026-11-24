import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: { default: 'Pansari Express', template: '%s · Pansari Express' },
  description: 'Jadibuti, pooja, shaadi samagri, dry fruits and daily kirana — delivered fast or bought by scanning the store QR.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbf6ee' },
    { media: '(prefers-color-scheme: dark)', color: '#140c07' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <Providers>{children}</Providers>
        <div id="recaptcha-container" />
      </body>
    </html>
  );
}
