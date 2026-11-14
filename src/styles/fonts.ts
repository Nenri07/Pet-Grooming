import { Plus_Jakarta_Sans, Inter, JetBrains_Mono } from 'next/font/google';

export const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-display',
});

export const inter = Inter({
  subsets: ['latin'],
  variable: '--font-body',
});

export const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
});

export const fontVars = `${jakarta.variable} ${inter.variable} ${jetbrains.variable}`;
