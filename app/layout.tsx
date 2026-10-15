import type { Metadata } from "next";
import "./globals.css";
import Analytics from "./analytics";
import AccessGuard from "./access-guard";

export const metadata: Metadata = {
  metadataBase: new URL("https://fc-support.kr"),
  applicationName: "FC-SUPPORT",
  title: "FC-SUPPORT | FC온라인 감독모드 데이터",
  description: "FC온라인 감독모드 상위 랭커의 실제 선발 스쿼드를 분석한 포지션별 선수 픽률 서비스",
  keywords: [
    "FC-SUPPORT", "FC SUPPORT", "fc-support", "fc support",
    "FC서포트", "FC 서포트", "fc서포트", "fc 서포트",
    "에프씨서포트", "에프씨 서포트", "에프씨 써포트",
    "FC온라인", "FC 온라인", "FC온라인 감독모드", "FC 온라인 감독모드",
    "감독모드 랭킹", "FC온라인 선수 픽률", "FC온라인 스쿼드", "FC온라인 데이터",
    "피파온라인4", "피파 온라인 4", "피파 감독모드",
  ],
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
  verification: {
    google: "IJozMzn6vLQegso9f5-CK1Om8rvaVsF9qO2oPJe_wvg",
  },
  openGraph: {
    type: "website",
    locale: "ko_KR",
    url: "/",
    siteName: "FC-SUPPORT",
    title: "FC-SUPPORT | FC온라인 감독모드 데이터",
    description: "FC온라인 감독모드 상위 랭커의 실제 선발 스쿼드를 분석한 포지션별 선수 픽률 서비스",
  },
  other: {
    "google-adsense-account": "ca-pub-1436343908093854",
  },
  icons: {
    icon: [{ url: "/favicon.png", type: "image/png" }],
    shortcut: "/favicon.png",
    apple: "/favicon.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: "FC-SUPPORT",
              url: "https://fc-support.kr/",
              inLanguage: "ko-KR",
              description: "FC온라인 감독모드 상위 랭커의 실제 선발 스쿼드를 분석한 포지션별 선수 픽률 서비스",
            }),
          }}
        />
      </head>
      <body><Analytics /><AccessGuard>{children}</AccessGuard></body>
    </html>
  );
}
