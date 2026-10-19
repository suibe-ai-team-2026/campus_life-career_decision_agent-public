"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocalProgress, isMeaningfulProgress, nextStepForProgress } from "@/lib/local-progress/store";
import { Icon } from "@/components/ui/primitives";
import { RestartProgress } from "./RestartProgress";
import { ThemeToggle } from "./ThemeToggle";

const NAV_ITEMS = [
  { href: "/", label: "首页" },
  { href: "/library", label: "资料库" }
] as const;

export function SiteHeader() {
  const pathname = usePathname();
  const { progress, hydrated } = useLocalProgress();
  const hasProgress = hydrated && progress !== null && isMeaningfulProgress(progress);
  const next = hasProgress && progress ? nextStepForProgress(progress) : null;

  function isActive(href: string): boolean {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href="/" className="brand" aria-label="知途 Campus Pathway 首页">
          <span className="brand-mark" aria-hidden="true">途</span>
          <span className="brand-text">
            <strong>知途</strong>
            <small>CAMPUS PATHWAY</small>
          </span>
        </Link>

        <nav className="site-nav" aria-label="主导航">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={isActive(item.href) ? "site-nav-link is-active" : "site-nav-link"}
              aria-current={isActive(item.href) ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
          <Link
            href={next ? next.href : "/explore"}
            className={pathname.startsWith("/explore") || pathname.startsWith("/directions") || pathname.startsWith("/choice") || pathname.startsWith("/plan") || pathname.startsWith("/export") ? "site-nav-link is-active" : "site-nav-link"}
          >
            {next ? "我的方案" : "五步向导"}
          </Link>
        </nav>

        <div className="site-header-actions">
          <ThemeToggle />
          {next ? (
            <Link href={next.href} className="header-cta">
              <Icon name="compass" size={14} />
              <span>
                继续 · 第 {next.index} 步 {next.title}
              </span>
            </Link>
          ) : (
            <Link href="/explore" className="header-cta">
              <Icon name="arrow-right" size={14} />
              <span>开始规划</span>
            </Link>
          )}
          {hasProgress ? <RestartProgress label="重新开始" variant="header" /> : null}
        </div>
      </div>
    </header>
  );
}
