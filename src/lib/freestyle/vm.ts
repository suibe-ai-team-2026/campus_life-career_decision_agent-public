import "server-only";

export type WakeResult = "started" | "already_running" | "not_configured" | "failed";

type VmState = { state?: string } | null;

async function freestyleFetch(path: string, init: RequestInit = {}) {
  const key = process.env.FREESTYLE_API_KEY;
  if (!key) throw new Error("freestyle_not_configured");
  const base = (process.env.FREESTYLE_API_BASE ?? "https://api.freestyle.sh").replace(/\/+$/, "");
  return fetch(`${base}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(15000)
  });
}

/**
 * Wakes the paused Freestyle worker VM before a user-triggered task.
 *
 * The worker pauses itself after an idle window. A paused VM resumes with the
 * old process state, so we also restart the worker container to clear its idle
 * clock; otherwise it can immediately re-pause before claiming the new job.
 * A wake failure never loses the queued run.
 */
export async function wakeWorker(): Promise<WakeResult> {
  const key = process.env.FREESTYLE_API_KEY;
  const vmId = process.env.FREESTYLE_VM_ID;
  if (!key || !vmId) return "not_configured";
  const vmPath = `/v5/vms/${encodeURIComponent(vmId)}`;
  try {
    const stateResponse = await freestyleFetch(vmPath, { method: "GET" });
    if (!stateResponse.ok) return "failed";
    const vm = (await stateResponse.json()) as VmState;
    const state = vm?.state;
    if (state === "running" || state === "starting") {
      // Worker is already polling; no need to restart and interrupt a job.
      return "already_running";
    }
    const startResponse = await freestyleFetch(`${vmPath}/start`, { method: "POST" });
    if (!startResponse.ok && startResponse.status !== 409) return "failed";
    // The paused process keeps its stale idle clock; restart it so it claims the
    // queued job instead of pausing again immediately.
    await freestyleFetch(`${vmPath}/exec-await`, {
      method: "POST",
      body: JSON.stringify({ command: "sudo -n docker restart campus-pathway-worker" })
    }).catch(() => undefined);
    return "started";
  } catch (error) {
    console.error("[freestyle] wake failed", error instanceof Error ? error.name : "unknown");
    return "failed";
  }
}
