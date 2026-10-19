import Link from "next/link";
import type { ReactNode } from "react";

export type IconName =
  | "arrow-right"
  | "arrow-left"
  | "check"
  | "cross"
  | "sparkles"
  | "shield"
  | "database"
  | "alert"
  | "compass"
  | "map"
  | "book"
  | "download"
  | "plus"
  | "minus"
  | "external"
  | "chevron-down"
  | "chevron-right"
  | "clock"
  | "flag"
  | "list"
  | "refresh"
  | "heart"
  | "info"
  | "sun"
  | "moon"
  | "monitor";

const ICON_PATHS: Record<IconName, ReactNode> = {
  "arrow-right": <path d="M5 12h14M13 6l6 6-6 6" />,
  "arrow-left": <path d="M19 12H5M11 6l-6 6 6 6" />,
  check: <path d="M20 6 9 17l-5-5" />,
  cross: <path d="M18 6 6 18M6 6l12 12" />,
  sparkles: (
    <>
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" />
      <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z" />
    </>
  ),
  shield: <path d="M12 3l7 3v5c0 4.4-2.9 8.3-7 10-4.1-1.7-7-5.6-7-10V6l7-3Z" />,
  database: (
    <>
      <ellipse cx="12" cy="5.5" rx="7" ry="2.5" />
      <path d="M5 5.5v13c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-13" />
      <path d="M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3 2.8 20h18.4L12 3Z" />
      <path d="M12 9v5M12 17.2v.1" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" />
    </>
  ),
  map: (
    <>
      <path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20V6.5Z" />
      <path d="M9 4v13.5M15 6.5V20" />
    </>
  ),
  book: (
    <>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15Z" />
      <path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20" />
    </>
  ),
  download: <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
  "chevron-down": <path d="m6 9 6 6 6-6" />,
  "chevron-right": <path d="m9 6 6 6-6 6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  flag: <path d="M5 21V4h13l-2.5 4.5L18 13H5" />,
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.1M3 12h.1M3 18h.1" />,
  refresh: <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />,
  heart: <path d="M12 20s-7-4.4-7-9.3A4.2 4.2 0 0 1 12 7a4.2 4.2 0 0 1 7 3.7C19 15.6 12 20 12 20Z" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.1" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />,
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  )
};

export function Icon({
  name,
  size = 16,
  className
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className ? `icon ${className}` : "icon"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

type ButtonProps = {
  children: ReactNode;
  href?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  disabled?: boolean;
  type?: "button" | "submit";
  onClick?: () => void;
  ariaLabel?: string;
  ariaDisabled?: boolean;
  title?: string;
  target?: string;
  rel?: string;
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", extra = ""): string {
  return ["btn", `btn-${variant}`, `btn-${size}`, extra].filter(Boolean).join(" ");
}

export function Button({
  children,
  href,
  variant = "primary",
  size = "md",
  className,
  disabled,
  type = "button",
  onClick,
  ariaLabel,
  ariaDisabled,
  title,
  target,
  rel
}: ButtonProps) {
  const classes = buttonClass(variant, size, className ?? "");
  if (href && !disabled) {
    const external = /^https?:\/\//i.test(href);
    if (external) {
      return (
        <a className={classes} href={href} title={title} aria-label={ariaLabel} target={target ?? "_blank"} rel={rel ?? "noopener noreferrer"}>
          {children}
        </a>
      );
    }
    return (
      <Link className={classes} href={href} title={title} aria-label={ariaLabel} aria-disabled={ariaDisabled}>
        {children}
      </Link>
    );
  }
  return (
    <button
      className={classes}
      type={type}
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
      aria-disabled={ariaDisabled}
      title={title}
    >
      {children}
    </button>
  );
}

export type BadgeTone = "neutral" | "accent" | "ok" | "warn" | "danger" | "muted" | "info";

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: BadgeTone; className?: string }) {
  return <span className={["badge", `badge-${tone}`, className].filter(Boolean).join(" ")}>{children}</span>;
}

export function Callout({
  tone = "info",
  title,
  children,
  icon = "info"
}: {
  tone?: "info" | "warn" | "danger" | "ok" | "plain";
  title?: ReactNode;
  children?: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className={`callout callout-${tone}`} role={tone === "danger" ? "alert" : undefined}>
      <Icon name={icon} size={18} className="callout-icon" />
      <div className="callout-body">
        {title ? <p className="callout-title">{title}</p> : null}
        {children ? <div className="callout-text">{children}</div> : null}
      </div>
    </div>
  );
}

export function EmptyState({
  icon = "compass",
  title,
  description,
  children,
  compact
}: {
  icon?: IconName;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "empty-state empty-state-compact" : "empty-state"}>
      <span className="empty-icon" aria-hidden="true">
        <Icon name={icon} size={compact ? 20 : 26} />
      </span>
      <p className="empty-title">{title}</p>
      {description ? <div className="empty-description">{description}</div> : null}
      {children ? <div className="empty-actions">{children}</div> : null}
    </div>
  );
}

export function ProgressBar({
  value,
  label,
  tone = "accent"
}: {
  value: number;
  label?: string;
  tone?: "accent" | "ok" | "warn";
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={`progress progress-${tone}`} role="group" aria-label={label ?? "进度"}>
      <div
        className="progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
        aria-label={label}
      >
        <span className="progress-fill" style={{ width: `${clamped}%` }} />
      </div>
      {label ? (
        <span className="progress-label">
          {label} · {clamped}%
        </span>
      ) : null}
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  actions,
  level = 2
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  level?: 2 | 3;
}) {
  const HeadingTag = level === 2 ? "h2" : "h3";
  return (
    <div className="section-heading">
      <div className="section-heading-text">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <HeadingTag>{title}</HeadingTag>
        {description ? <div className="section-description">{description}</div> : null}
      </div>
      {actions ? <div className="section-heading-actions">{actions}</div> : null}
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={["field", className].filter(Boolean).join(" ")}>
      <label className="field-label" htmlFor={htmlFor}>
        {label}
        {required ? <span className="field-required" aria-hidden="true"> *</span> : null}
      </label>
      {children}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="field-hint">{hint}</p>
      ) : null}
    </div>
  );
}

export function ListBlock({ items, tone = "neutral" }: { items: ReactNode[]; tone?: "neutral" | "warn" }) {
  return (
    <ul className={tone === "warn" ? "list-block list-block-warn" : "list-block"}>
      {items.map((item, index) => (
        <li key={index}>
          <Icon name={tone === "warn" ? "alert" : "check"} size={14} />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  // Fixed time zone keeps server-rendered markup and client hydration identical.
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Shanghai"
  }).format(date);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Shanghai"
  }).format(date);
}

export function daysUntil(value: string | null | undefined): number | null {
  if (!value) return null;
  const target = new Date(`${value}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}
