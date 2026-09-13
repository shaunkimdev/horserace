import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const h = await headers();
  const host = h.get("host") || "localhost:3000";
  const protocol =
    host.includes("localhost") || host.startsWith("127.") ? "http" : "https";
  const origin = `${protocol}://${host}`;
  return {
    metadataBase: new URL(origin),
    title: "DRAW DERBY — 그려요. 달려요.",
    description:
      "당신의 낙서가 선수가 됩니다. 직접 그린 동물로 최대 4명이 함께 달리는 장애물 경주. 그림 실력은 선택, 다리는 필수!",
    openGraph: {
      title: "DRAW DERBY — 그려요. 달려요.",
      description:
        "DRAW A LITTLE. RACE A LOT. 친구와 함께 달리는 손그림 동물 레이싱.",
      locale: "ko_KR",
      type: "website",
      images: [{ url: `${origin}/og.png`, width: 1732, height: 908 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "DRAW DERBY",
      description: "당신의 낙서가 선수가 됩니다. 최대 4인 동물 레이싱.",
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
