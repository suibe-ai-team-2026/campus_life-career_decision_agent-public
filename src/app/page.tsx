import Link from "next/link";
import { WIZARD_STEPS } from "@/lib/content";
import { HomeContinueCard } from "@/components/layout/HomeContinueCard";
import { Icon } from "@/components/ui/primitives";

export default function HomePage() {
  return (
    <main id="main" className="home">
      <section className="home-hero" aria-labelledby="hero-title">
        <h1 id="hero-title">把「我该往哪走」，<br />变成一条可核对的路。</h1>
        <p className="home-hero-lead">
          先看清方向，再落成可调整的行动方案。
        </p>
        <div className="home-hero-actions">
          <Link href="/explore" className="btn btn-primary btn-lg">
            开始规划
            <Icon name="arrow-right" size={16} />
          </Link>
          <Link href="/library" className="btn btn-secondary btn-lg">
            先查资料
          </Link>
        </div>
        <p className="home-hero-note">无需注册 · 可导出 PDF</p>
      </section>

      <section aria-label="继续上次进度">
        <HomeContinueCard />
      </section>

      <nav className="home-steps" aria-label="五步向导">
        {WIZARD_STEPS.map((step) => (
          <Link key={step.href} href={step.href} className="home-step">
            <span className="home-step-num">0{step.index}</span>
            <span className="home-step-title">{step.shortTitle}</span>
          </Link>
        ))}
      </nav>
    </main>
  );
}
