import type { Metadata } from 'next';
import { Geist_Mono, Noto_Sans_KR } from 'next/font/google';

import './globals.css';

const notoSansKr = Noto_Sans_KR({
  variable: '--font-sans',
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  display: 'swap',
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Seoul Vibe — 서울 실시간 혼잡도',
  description:
    '서울시 주요 121장소의 실시간 인구 혼잡도와 따릉이 대여소 현황을 지도에 얹어 봅니다. 서울 열린데이터광장 실시간 도시데이터 기반.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="ko"
      className={`dark ${notoSansKr.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="bg-background text-foreground min-h-full">{children}</body>
    </html>
  );
}
