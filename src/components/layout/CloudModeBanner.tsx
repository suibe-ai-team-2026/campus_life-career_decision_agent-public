"use client";

import { cloudConfigured } from "@/lib/api-client";
import { Icon } from "@/components/ui/primitives";

/**
 * Always-visible mode indicator. When the public Supabase configuration is
 * absent the app is a fully usable local demo: progress, direction browsing and
 * the export empty state work, but cloud generation is not enabled.
 */
export function CloudModeBanner() {
  if (cloudConfigured()) return null;
  return (
    <div className="mode-banner" role="status">
      <Icon name="database" size={14} />
      <strong>本地演示模式</strong>
      <span className="mode-banner-sep" aria-hidden="true">·</span>
      <span>仅本地进度，云端生成未启用</span>
      <span className="mode-banner-note">五步中的 Step 1–3 与导出空态可完整走通</span>
    </div>
  );
}
