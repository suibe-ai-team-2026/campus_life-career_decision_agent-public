import Link from "next/link";

export const metadata = {
  title: "页面不存在"
};

/**
 * 全局 404：默认的 Next.js 404 是英文且只有页脚导航，和中文站不一致。
 * 这里给中文标题、明确下一步（回首页 / 看看资料库），保持和站内一致的排版。
 */
export default function NotFound() {
  return (
    <main id="main" className="screen not-found-screen">
      <section className="panel not-found-panel" aria-labelledby="not-found-title">
        <p className="not-found-code" aria-hidden="true">
          404
        </p>
        <h1 id="not-found-title">这个地址没有对应的页面</h1>
        <p className="panel-subtitle">
          链接可能已经更新，或者地址打错了一个字符。用下面的两个入口可以继续。
        </p>
        <div className="not-found-actions">
          <Link href="/" className="btn btn-primary btn-md">
            返回首页
          </Link>
          <Link href="/library" className="btn btn-secondary btn-md">
            去资料库
          </Link>
        </div>
      </section>
    </main>
  );
}
