"use client";

import { useId } from "react";
import { Icon } from "@/components/ui/primitives";

export type ResearchToggleProps = {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Short switch label, e.g. 「联网补充」. */
  label: string;
  /** One-line explanation shown under the switch. Must mention external sites + unverified results. */
  description: string;
  disabled?: boolean;
  className?: string;
};

/**
 * Opt-in switch for live web research. The worker only reaches the public web
 * when the submitted run carries `web_search: true`, so the copy here is part of
 * the consent boundary: it always says that external sites are visited and that
 * the results are unverified.
 */
export function ResearchToggle({ checked, onChange, label, description, disabled, className }: ResearchToggleProps) {
  const id = useId();
  return (
    <div className={["research-toggle", checked ? "is-on" : "", disabled ? "is-disabled" : "", className ?? ""].filter(Boolean).join(" ")}>
      <label className="research-toggle-row" htmlFor={id}>
        <span className="research-toggle-copy">
          <span className="research-toggle-title">
            <Icon name="globe" size={14} />
            {label}
            <span className="research-toggle-state">{checked ? "已开启" : "已关闭"}</span>
          </span>
        </span>
        <input
          id={id}
          type="checkbox"
          role="switch"
          className="research-toggle-input"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="research-toggle-track" aria-hidden="true">
          <span className="research-toggle-knob" />
        </span>
      </label>
      <p className="research-toggle-note">{description}</p>
    </div>
  );
}
