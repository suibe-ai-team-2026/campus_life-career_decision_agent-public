import Link from "next/link";
import type { ReactNode } from "react";
import { WIZARD_STEPS } from "@/lib/content";
import { Badge, Icon } from "@/components/ui/primitives";

/**
 * Shared per-step chrome: compact breadcrumb, title, one-line subtitle and a
 * page-specific action slot (usually "跳过这一步" + primary continue).
 *
 * 副标题只放一行短提示；长解释一律交给页面里的 <Collapse>，避免每步开头堆成 PRD 段落。
 */
export function StepHeader({
  index,
  title,
  description,
  actions,
  meta,
  backHref = "/",
  backLabel = "返回首页"
}: {
  index: number;
  title: ReactNode;
  description: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  backHref?: string;
  backLabel?: string;
}) {
  const step = WIZARD_STEPS[index - 1];
  return (
    <header className="screen-head">
      <div>
        <p className="small-note">
          <Link href={backHref} className="back-link">
            <Icon name="arrow-left" size={14} />
            {backLabel}
          </Link>
          <span aria-hidden="true"> · </span>
          第 {step.index} 步 · {step.title}
          <span aria-hidden="true"> · </span>
          <Badge tone="muted">{step.estimate}</Badge>
        </p>
        <h1>{title}</h1>
        <p className="screen-sub">{description}</p>
        {meta ? <div className="step-header-meta">{meta}</div> : null}
      </div>
      {actions ? <div className="step-header-actions">{actions}</div> : null}
    </header>
  );
}
