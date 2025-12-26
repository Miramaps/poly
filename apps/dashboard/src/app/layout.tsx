import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Poly Trader | Dashboard',
  description: 'Polymarket Paper Trading Bot Dashboard',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-background text-foreground font-sans antialiased">
        <div className="min-h-screen bg-gradient-radial">
          {children}
        </div>
      </body>
    </html>
  );
}

