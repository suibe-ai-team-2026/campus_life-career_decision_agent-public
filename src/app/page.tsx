import Link from "next/link";
import { WIZARD_STEPS } from "@/lib/content";
import { HomeContinueCard } from "@/components/layout/HomeContinueCard";
import { Collapse, Icon } from "@/components/ui/primitives";

export default function HomePage() {
  return (
    <main id="main" className="home">
      <section className="home-hero" aria-labelledby="hero-title">
        <h1 id="hero-title">把「我该往哪走」，<br />变成一条可核对的路。</h1>
        <p className="home-hero-lead">
          10 分钟，用一份职业探索问卷整理你现在的兴趣、能力与准备度，得到可比较的方向与可调整的行动方案。
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
        <p className="home-hero-note">无需注册，进度保存在本设备，方案可导出 PDF</p>
      </section>

      <section aria-label="继续上次进度">
        <HomeContinueCard />
      </section>

      <nav className="home-steps" aria-label="五步向导">
        {WIZARD_STEPS.map((step) => (
          <Link key={step.href} href={step.href} className="home-step">
            <span className="home-step-num">0{step.index}</span>
            <span className="home-step-title">{step.shortTitle}</span>
            <span className="home-step-est">{step.estimate}</span>
          </Link>
        ))}
      </nav>

      <div className="home-about">
        <Collapse summary={<>数据与你</>}>
          <p>
            作答与生成的方案会上传到云端服务用于生成与保存；本设备保留一份进度，刷新可恢复。问卷是产品自编的生涯探索工具，不是标准化测评。
          </p>
          <p>页面只展示已核验或明确标注「待核验」的资料；资料未就绪时直接说明，不用虚构数字补齐。</p>
        </Collapse>
        <Collapse summary={<>关于知途</>} tone="quiet">
          <p>
            面向还没有明确方向、但已开始为课程、实习与升学做准备的同学：先看清方向，再暂定，最后把课程、竞赛与阶段安排落成可调整的方案。
          </p>
        </Collapse>
      </div>
    </main>
  );
}
