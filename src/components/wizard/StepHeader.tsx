import Link from "next/link";
import type { ReactNode } from "react";
import { WIZARD_STEPS } from "@/lib/content";
import { Badge, Icon } from "@/components/ui/primitives";

/**
 * Shared per-step chrome: back link, step number/estimate, title, description and
 * a page-specific action slot (usually "跳过这一步" + primary continue).
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
    <header className="step-header">
      <div className="step-header-main">
        <div className="step-header-eyebrow">
          <Link href={backHref} className="back-link">
            <Icon name="arrow-left" size={14} />
            {backLabel}
          </Link>
          <span className="step-header-crumb" aria-hidden="true">/</span>
          <span className="step-header-step">
            第 {step.index} 步 · {step.title}
          </span>
          <Badge tone="muted">{step.estimate}</Badge>
        </div>
        <h1>{title}</h1>
        <div className="step-header-description">{description}</div>
        {meta ? <div className="step-header-meta">{meta}</div> : null}
      </div>
      {actions ? <div className="step-header-actions">{actions}</div> : null}
    </header>
  );
}
