"use client";

import { cloudConfigured } from "@/lib/api-client";

/**
 * Public Supabase configuration absent → the app runs as a local demo:
 * progress and direction browsing work, cloud generation does not.
 */
export function CloudModeBanner() {
  if (cloudConfigured()) return null;
  return (
    <div className="mode-banner" role="status">
      <strong>本地演示模式</strong>
      <span className="mode-banner-sep" aria-hidden="true">·</span>
      <span>云端生成未启用</span>
    </div>
  );
}
