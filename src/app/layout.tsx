import type { Metadata, Viewport } from "next";
import "./globals.css";
import { CloudModeBanner } from "@/components/layout/CloudModeBanner";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";

export const metadata: Metadata = {
  title: {
    default: "知途 Campus Pathway · 五步生涯向导",
    template: "%s · 知途 Campus Pathway"
  },
  description:
    "知途（Campus Pathway）是面向大一大二学生的生涯规划向导：自编轻测画像、六个方向的牌面与数据缺口、可调整的行动方案，以及带引用与资料版本的 PDF。",
  applicationName: "知途 Campus Pathway",
  icons: {
    icon: "/favicon.svg"
  },
  robots: {
    index: false,
    follow: false
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#171310"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" data-scroll-behavior="smooth">
      <body>
        <a className="skip-link" href="#main">
          跳到主要内容
        </a>
        <CloudModeBanner />
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
