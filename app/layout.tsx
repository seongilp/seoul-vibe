import type { Metadata, Viewport } from 'next';
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

/*
  viewportFit: 'cover' 가 없으면 env(safe-area-inset-*) 가 전부 0 으로 계산된다.
  즉 이게 빠지면 노치·홈 인디케이터 대응 CSS 가 조용히 죽은 코드가 된다.
  maximumScale 은 일부러 두지 않는다 — 확대를 막으면 접근성이 나빠진다.
*/
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0f1013',
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
