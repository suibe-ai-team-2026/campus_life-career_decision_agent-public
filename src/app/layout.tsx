import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./design-v3.css";
import { CloudModeBanner } from "@/components/layout/CloudModeBanner";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";

export const metadata: Metadata = {
  title: {
    default: "知途 Campus Pathway",
    template: "%s · 知途"
  },
  description: "知途：面向大一大二学生的生涯规划向导。职业探索画像、可比较的方向、可调整的行动方案与带引用的 PDF。",
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
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0f1112" },
    { media: "(prefers-color-scheme: light)", color: "#f4f3ef" }
  ]
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script
          // Applies a saved explicit theme before first paint; system mode uses CSS media.
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var m=localStorage.getItem('campus-pathway:theme');if(m==='light'||m==='dark'){document.documentElement.dataset.theme=m;}}catch(e){}})();"
          }}
        />
      </head>
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
