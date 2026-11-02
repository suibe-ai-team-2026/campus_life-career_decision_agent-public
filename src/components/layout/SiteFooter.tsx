import Link from "next/link";
import { Icon } from "@/components/ui/primitives";
import { RESOURCE_BOUNDARIES } from "@/lib/content";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="footer-row">
          <span className="footer-brand">知途 Campus Pathway</span>
          <nav className="footer-links" aria-label="页脚导航">
            <Link href="/">首页</Link>
            <Link href="/explore">开始探索</Link>
            <Link href="/library">资料库</Link>
            <Link href="/plan">行动方案</Link>
          </nav>
          <span className="footer-copy">© {new Date().getFullYear()} 比赛 MVP</span>
        </div>
        <p className="footer-note">
          <Icon name="shield" size={13} />
          {RESOURCE_BOUNDARIES[0]}；不构成正式测评、就业承诺或报考资格结论
        </p>
      </div>
    </footer>
  );
}
