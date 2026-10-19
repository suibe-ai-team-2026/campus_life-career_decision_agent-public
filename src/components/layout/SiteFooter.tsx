import Link from "next/link";
import { Icon } from "@/components/ui/primitives";
import { RESOURCE_BOUNDARIES } from "@/lib/content";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-brand">
          <div className="brand brand-static">
            <span className="brand-mark" aria-hidden="true">途</span>
            <span className="brand-text">
              <strong>知途</strong>
              <small>CAMPUS PATHWAY</small>
            </span>
          </div>
          <p className="site-footer-tagline">
            把生涯方向从感觉，变成可核对、可调整、可复核的路径。
          </p>
          <p className="site-footer-meta">首届「数字赋能经贸，智创未来校园」AI 创新应用大赛参赛作品</p>
        </div>
        <nav className="site-footer-links" aria-label="页脚导航">
          <Link href="/">首页</Link>
          <Link href="/explore">开始探索</Link>
          <Link href="/library">资料库</Link>
          <Link href="/plan">行动方案</Link>
        </nav>
        <div className="site-footer-boundary">
          <p className="site-footer-heading">
            <Icon name="shield" size={14} /> 资料边界
          </p>
          <ul>
            {RESOURCE_BOUNDARIES.slice(0, 3).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className="site-footer-bottom">
        <span>© {new Date().getFullYear()} 知途 Campus Pathway · 比赛 MVP，不接入支付</span>
        <span>本产品不构成正式测评、就业承诺或报考资格结论</span>
      </div>
    </footer>
  );
}
