import "server-only";

export type WakeResult = "started" | "already_running" | "not_configured" | "failed";

/**
 * Wakes the paused Freestyle worker VM before a user-triggered task. The worker
 * pauses itself after an idle window; this call is what keeps idle compute at
 * zero without asking the browser to talk to a public Python port.
 *
 * Never throws: a wake failure must not lose the already-queued run.
 */
export async function wakeWorker(): Promise<WakeResult> {
  const key = process.env.FREESTYLE_API_KEY;
  const vmId = process.env.FREESTYLE_VM_ID;
  if (!key || !vmId) return "not_configured";
  const base = (process.env.FREESTYLE_API_BASE ?? "https://api.freestyle.sh").replace(/\/+$/, "");
  try {
    const response = await fetch(`${base}/v5/vms/${encodeURIComponent(vmId)}/start`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000)
    });
    if (response.status === 409) return "already_running";
    return response.ok ? "started" : "failed";
  } catch (error) {
    console.error("[freestyle] wake failed", error instanceof Error ? error.name : "unknown");
    return "failed";
  }
}
