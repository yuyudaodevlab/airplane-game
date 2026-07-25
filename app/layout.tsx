import type { Metadata } from "next";
import { Noto_Sans_JP, Space_Mono } from "next/font/google";
import "./globals.css";

const noto = Noto_Sans_JP({
  variable: "--font-noto",
  subsets: ["latin"],
  weight: ["500", "700", "900"],
});

const mono = Space_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
});

const siteUrl = new URL("https://yuyudaodevlab.github.io/airplane-game/");
const assetBasePath = process.env.GITHUB_ACTIONS === "true" ? "/airplane-game" : "";

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: "POCKET FLIGHT | 引っぱって飛ばす飛行機ゲーム",
  description: "機体を引っぱってテイクオフ。揚力、失速、風、衝突と破損を乗り越え、どこまでも飛ぼう。",
  icons: {
    icon: `${assetBasePath}/favicon.svg`,
    shortcut: `${assetBasePath}/favicon.svg`,
  },
  openGraph: {
    title: "POCKET FLIGHT",
    description: "引っぱって、飛ばして、壊れて、また強くなる。",
    type: "website",
    images: [{ url: "og.png", width: 1792, height: 896, alt: "POCKET FLIGHT の木製飛行機が発射されるゲームアート" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "POCKET FLIGHT",
    description: "引っぱって、飛ばして、壊れて、また強くなる。",
    images: ["og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body className={`${noto.variable} ${mono.variable}`}>{children}</body>
    </html>
  );
}
