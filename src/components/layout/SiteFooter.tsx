import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="footer-row">
          <span className="footer-brand">
            知途 <span lang="en">Campus Pathway</span>
          </span>
          <nav className="footer-links" aria-label="页脚导航">
            <Link href="/">首页</Link>
            <Link href="/explore">开始探索</Link>
            <Link href="/library">资料库</Link>
            <Link href="/graph">知识图谱</Link>
            <Link href="/plan">行动方案</Link>
          </nav>
          <span className="footer-copy">
            © {new Date().getFullYear()} 知途 · 比赛作品
          </span>
        </div>
        <p className="footer-note">知途把已有资料整理成可执行的下一步；最终行政认定以学校当年文件为准。</p>
      </div>
    </footer>
  );
}
