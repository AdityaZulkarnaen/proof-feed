import type { Metadata } from 'next';
import { Archivo, Archivo_Narrow, JetBrains_Mono } from 'next/font/google';
import './globals.css';

/*
 * Faces chosen as instrument parts, not genre signals. Archivo Narrow is the condensed engineering
 * grotesque a station label is stamped in; Archivo carries running text. JetBrains Mono appears
 * only on hashes and addresses, where distinguishing 0 from O and 1 from l against a block explorer
 * is a real task a proportional face would make worse.
 */
const label = Archivo_Narrow({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  variable: '--font-label',
  display: 'swap',
});

const body = Archivo({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-body',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'ProofFeed — Chainlink rounds on Creditcoin, verified by Attestcoin',
  description:
    'Real Ethereum-mainnet Chainlink price rounds proven onto Creditcoin by the Attestcoin Protocol. The 2023 USDC depeg round, $0.88, is stored on chain. There is no setPrice.',
  openGraph: {
    title: 'ProofFeed — a price feed with no setPrice',
    description:
      'The Chainlink round that printed $0.88 during the SVB collapse now lives on Creditcoin, proven from the original mainnet transaction.',
    type: 'website',
  },
};

export const viewport = { themeColor: '#14110e' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${label.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
