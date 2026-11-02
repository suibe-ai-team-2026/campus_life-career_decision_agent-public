"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocalProgress, isMeaningfulProgress, nextStepForProgress } from "@/lib/local-progress/store";
import { Icon } from "@/components/ui/primitives";
import { ThemeToggle } from "./ThemeToggle";

const NAV_ITEMS = [
  { href: "/", label: "首页" },
  { href: "/library", label: "资料库" }
] as const;

export function SiteHeader() {
  const pathname = usePathname();
  const { progress, hydrated } = useLocalProgress();
  const next = hydrated && progress && isMeaningfulProgress(progress) ? nextStepForProgress(progress) : null;
  const inWizard =
    pathname?.startsWith("/explore") ||
    pathname?.startsWith("/directions") ||
    pathname?.startsWith("/choice") ||
    pathname?.startsWith("/plan") ||
    pathname?.startsWith("/export");

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href="/" className="brand" aria-label="知途 Campus Pathway 首页">
          <span className="brand-mark" aria-hidden="true">途</span>
          <span className="brand-text">
            <strong>知途</strong>
            <small>Campus Pathway</small>
          </span>
        </Link>

        <nav className="site-nav" aria-label="主导航">
          {NAV_ITEMS.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname === item.href || pathname?.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? "site-nav-link is-active" : "site-nav-link"}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
          <Link href={next ? next.href : "/explore"} className={inWizard ? "site-nav-link is-active" : "site-nav-link"}>
            {next ? "我的方案" : "五步向导"}
          </Link>
        </nav>

        <div className="site-header-actions">
          <ThemeToggle />
          <Link href={next ? next.href : "/explore"} className="header-cta">
            {next ? (
              <>
                <span className="header-cta-step">第 {next.index} 步</span>
                <Icon name="arrow-right" size={14} />
              </>
            ) : (
              <>
                开始
                <Icon name="arrow-right" size={14} />
              </>
            )}
          </Link>
        </div>
      </div>
    </header>
  );
}
