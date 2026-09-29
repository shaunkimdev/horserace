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
    title: "드로우 더비 — 나만의 낙서 운동장",
    description:
      "직접 그린 러너로 떠나는 한 바퀴. 네 가지 트랙에서 혼자 연습하거나 최대 8명의 친구와 함께 달려보세요.",
    openGraph: {
      title: "드로우 더비 — 나만의 낙서 운동장",
      description:
        "내가 그린 모습으로 달려요. 친구와 함께하는 낙서 운동장.",
      locale: "ko_KR",
      type: "website",
      images: [{ url: `${origin}/og.png`, width: 1732, height: 908 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "DRAW DERBY",
      description: "직접 만든 러너, 네 가지 트랙, 최대 8명의 친구. 나만의 낙서 운동장.",
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
