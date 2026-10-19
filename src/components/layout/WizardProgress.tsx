"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WIZARD_STEPS } from "@/lib/content";
import { progressStepDone, useLocalProgress } from "@/lib/local-progress/store";
import { Icon } from "@/components/ui/primitives";

export function WizardProgress() {
  const pathname = usePathname();
  const { progress } = useLocalProgress();
  const currentIndex = WIZARD_STEPS.find((step) => pathname?.startsWith(step.href))?.index ?? 0;

  return (
    <div className="wizard-progress-wrap">
      <div className="wizard-progress-inner">
        <nav className="wizard-progress" aria-label="五步向导进度">
          <ol>
            {WIZARD_STEPS.map((step) => {
              const done = progress ? progressStepDone(progress, step.index) : false;
              const current = step.index === currentIndex;
              return (
                <li key={step.href} className={["wp-step", current ? "is-current" : "", done ? "is-done" : ""].filter(Boolean).join(" ")}>
                  <Link
                    href={step.href}
                    aria-current={current ? "step" : undefined}
                    aria-label={`第 ${step.index} 步 ${step.title}${done ? "（已完成）" : ""}`}
                  >
                    <span className="wp-num" aria-hidden="true">
                      {done && !current ? <Icon name="check" size={13} /> : step.index}
                    </span>
                    <span className="wp-label">{step.shortTitle}</span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </nav>
        <p className="wp-save-note">
          <Icon name="clock" size={12} />
          每步自动保存在本设备，刷新可恢复
        </p>
      </div>
    </div>
  );
}
