import Link from "next/link";
import {
  DATA_SOURCES,
  DIRECTIONS,
  DIRECTIONS_CATEGORY_VERSION,
  HOME_BOUNDARIES,
  RESOURCE_BOUNDARIES,
  WIZARD_STEPS,
  getDirection
} from "@/lib/content";
import { HomeContinueCard } from "@/components/layout/HomeContinueCard";
import { Badge, Icon, ListBlock } from "@/components/ui/primitives";

export default function HomePage() {
  const previewDirection = getDirection("trade_supply_chain") ?? DIRECTIONS[0];

  return (
    <main id="main" className="site-main">
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">
              <Icon name="compass" size={14} />
              知途 · Campus Pathway · 五步生涯向导
            </p>
            <h1 id="hero-title">
              把「我该往哪走」
              <br />
              变成一条<span className="accent-text">可核对的路</span>
            </h1>
            <p className="hero-lead">
              知途把学校专业、方向牌面、已核技能与准备成本摊开，用自编轻测形成描述性画像，再生成可调整的行动方案与带引用的 PDF。
              <strong>AI 只做解释：不替你做决定、不算数、不编造。</strong>
            </p>
            <div className="hero-actions">
              <Link href="/explore" className="btn btn-primary btn-lg">
                <Icon name="arrow-right" size={16} />
                开始我的规划（约 10 分钟）
              </Link>
              <Link href="/library" className="btn btn-secondary btn-lg">
                <Icon name="book" size={16} />
                直接查资料
              </Link>
            </div>
            <ul className="hero-meta" aria-label="产品要点">
              <li>
                <Icon name="clock" size={14} />
                约 10 分钟 · 5 步
              </li>
              <li>
                <Icon name="shield" size={14} />
                首次不要求注册
              </li>
              <li>
                <Icon name="database" size={14} />
                进度只保存在本设备
              </li>
            </ul>
          </div>

          <aside className="hero-preview" aria-label="方向卡预览">
            <div className="hero-preview-top">
              <span className="preview-kicker">方向牌面 · 预览</span>
              <Badge tone="muted">静态预览 · 非实时数据</Badge>
            </div>
            <h2>{previewDirection.title}</h2>
            <p className="preview-summary">{previewDirection.summary}</p>
            <div className="preview-section">
              <span className="preview-label">日常工作内容</span>
              <div className="chip-row">
                {previewDirection.work_content.slice(0, 4).map((item) => (
                  <span className="chip" key={item}>
                    {item}
                  </span>
                ))}
              </div>
            </div>
            <div className="preview-section">
              <span className="preview-label">已核技能</span>
              <div className="chip-row">
                {previewDirection.verified_skills.slice(0, 4).map((item) => (
                  <span className="chip chip-amber" key={item}>
                    {item}
                  </span>
                ))}
              </div>
            </div>
            <div className="preview-section">
              <span className="preview-label">准备成本</span>
              <p className="preview-text">{previewDirection.preparation_cost}</p>
            </div>
            <div className="preview-section preview-gap">
              <span className="preview-label">
                <Icon name="alert" size={13} /> 数据缺口
              </span>
              <p className="preview-text">{previewDirection.data_gaps[0]}</p>
            </div>
            <p className="preview-footnote">
              六个方向是产品导航分类，不是学校官方就业分类 · 分类版本 {DIRECTIONS_CATEGORY_VERSION}
            </p>
          </aside>
        </div>
      </section>

      <section className="home-continue-zone" aria-label="继续上次进度">
        <HomeContinueCard />
      </section>

      <section className="home-section" aria-labelledby="steps-title">
        <div className="section-heading">
          <div className="section-heading-text">
            <p className="eyebrow">五步向导</p>
            <h2 id="steps-title">从牌面到路径，每一步都留下可复核的记录</h2>
            <p className="section-description">
              你可以随时返回、跳过单题或整步，也可以在任一页重新开始。进度自动保存在本设备，刷新不会丢。
            </p>
          </div>
          <div className="section-heading-actions">
            <Link href="/explore" className="btn btn-secondary btn-sm">
              从第 1 步开始
              <Icon name="arrow-right" size={14} />
            </Link>
          </div>
        </div>
        <ol className="steps-grid">
          {WIZARD_STEPS.map((step) => (
            <li key={step.href} className="step-card">
              <div className="step-card-top">
                <span className="step-number">0{step.index}</span>
                <span className="step-estimate">{step.estimate}</span>
              </div>
              <h3>
                <Link href={step.href}>{step.title}</Link>
              </h3>
              <p>{step.description}</p>
              <Link href={step.href} className="step-card-link" aria-label={`进入第 ${step.index} 步 ${step.title}`}>
                进入这一步
                <Icon name="chevron-right" size={14} />
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section className="home-section home-section-split" aria-labelledby="scope-title">
        <div className="scope-copy">
          <p className="eyebrow">为谁而做</p>
          <h2 id="scope-title">面向大一大二，而不是「一次定终身」</h2>
          <p className="section-description">
            知途面向还没有明确方向、但已经开始为课程、实习与升学做准备的校园用户。它不提供「最适合你的职业」结论，而是把选择所需的牌面、证据、代价和可调整路径摆清楚。
          </p>
          <div className="scope-points">
            <div className="scope-point">
              <Icon name="compass" size={18} />
              <div>
                <h3>先看清，再暂定</h3>
                <p>方向卡展示工作内容、已核技能、准备成本、适用范围与数据缺口，不用排名制造确定性。</p>
              </div>
            </div>
            <div className="scope-point">
              <Icon name="flag" size={18} />
              <div>
                <h3>暂定不是承诺</h3>
                <p>暂定方向写清理由、未知与复核时间；切换方向时旧方案会标记 stale，历史版本保留提示。</p>
              </div>
            </div>
            <div className="scope-point">
              <Icon name="download" size={18} />
              <div>
                <h3>带走可核对的 PDF</h3>
                <p>导出的 PDF 带引用、资料版本与待核验项，并明确写明这是自编轻测与自评，不是就业承诺。</p>
              </div>
            </div>
          </div>
        </div>
        <div className="scope-aside">
          <div className="panel">
            <p className="panel-title">
              <Icon name="database" size={15} /> 数据来源（授权材料）
            </p>
            <ListBlock items={DATA_SOURCES.slice()} />
            <p className="panel-note">
              本产品不联网抓取、不展示未核证的通过率、薪资、录取概率或报考资格结论。
            </p>
          </div>
          <div className="panel">
            <p className="panel-title">
              <Icon name="alert" size={15} /> 资料边界
            </p>
            <ul className="boundary-list">
              {RESOURCE_BOUNDARIES.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="home-section home-section-ai" aria-labelledby="ai-title">
        <div className="section-heading">
          <div className="section-heading-text">
            <p className="eyebrow">AI 的角色</p>
            <h2 id="ai-title">AI 不替你做决定，也不算数，更不编造</h2>
          </div>
        </div>
        <div className="boundary-grid">
          {HOME_BOUNDARIES.map((item, index) => (
            <article className="boundary-card" key={item.title}>
              <span className="boundary-index">0{index + 1}</span>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="home-cta" aria-labelledby="final-cta-title">
        <div>
          <p className="eyebrow">现在开始</p>
          <h2 id="final-cta-title">先花 10 分钟，把「感觉」变成一张可核对的路径图</h2>
          <p>
            不需要注册，不会上传成绩单或个人信息；你的作答与进度默认只保存在本设备的浏览器里。
          </p>
        </div>
        <div className="home-cta-actions">
          <Link href="/explore" className="btn btn-primary btn-lg">
            <Icon name="arrow-right" size={16} />
            开始我的规划（约 10 分钟）
          </Link>
          <Link href="/library" className="btn btn-secondary btn-lg">
            <Icon name="book" size={16} />
            直接查资料
          </Link>
        </div>
      </section>

      <section className="home-disclaimer" aria-label="免责声明">
        <p>
          <Icon name="info" size={14} />
          知途是比赛 MVP：轻测为产品自编的探索工具，规划结果用于辅助思考与复核，不构成正式心理测评、就业承诺、录取或报考资格结论。若资料未载入，页面会显示「资料未就绪」或数据缺口，不用虚构数字补齐。
        </p>
      </section>
    </main>
  );
}
