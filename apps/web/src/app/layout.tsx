import { DM_Sans, Fraunces } from 'next/font/google';
import './globals.css';
import { CartProvider } from '@/components/CartProvider';
import { Header } from '@/components/Header';
import { ToastProvider } from '@/components/ToastProvider';
import { VoiceAssistantPanel } from '@/components/VoiceAssistantPanel';

const sans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-sans',
});

const display = Fraunces({
  subsets: ['latin'],
  variable: '--font-display',
});

export const metadata = {
  title: 'Live Shop',
  description: 'Premium multi-category ecommerce with live shopping',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable}`}>
      <body>
        <ToastProvider>
          <CartProvider>
            <Header />
            {children}
            <VoiceAssistantPanel />
          </CartProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
