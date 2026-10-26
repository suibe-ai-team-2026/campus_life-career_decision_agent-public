import "server-only";

export type WakeResult = "started" | "already_running" | "starting" | "not_configured" | "failed";

export type WorkerVmState = {
  state: "running" | "starting" | "paused" | "stopped" | "unknown" | "not_configured";
  checked_at: string;
};

type VmState = { state?: string } | null;

async function freestyleFetch(path: string, init: RequestInit = {}, timeoutMs = 10000) {
  const key = process.env.FREESTYLE_API_KEY;
  if (!key) throw new Error("freestyle_not_configured");
  const base = (process.env.FREESTYLE_API_BASE ?? "https://api.freestyle.sh").replace(/\/+$/, "");
  return fetch(`${base}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs)
  });
}

/* Health checks must stay cheap: the VM state changes slowly and Freestyle's
   control plane can be slow, so cache the last answer briefly. */
let cachedVmState: { value: WorkerVmState; at: number } | null = null;

export async function getWorkerVmState(): Promise<WorkerVmState> {
  const key = process.env.FREESTYLE_API_KEY;
  const vmId = process.env.FREESTYLE_VM_ID;
  if (!key || !vmId) {
    return { state: "not_configured", checked_at: new Date().toISOString() };
  }
  if (cachedVmState && Date.now() - cachedVmState.at < 15000) return cachedVmState.value;
  const checkedAt = new Date().toISOString();
  try {
    const response = await freestyleFetch(`/v5/vms/${encodeURIComponent(vmId)}`, { method: "GET" }, 6000);
    if (!response.ok) {
      return { state: "unknown", checked_at: checkedAt };
    }
    const vm = (await response.json()) as VmState;
    const raw = vm?.state;
    const state: WorkerVmState["state"] =
      raw === "running" || raw === "starting" || raw === "paused" || raw === "stopped" ? raw : "unknown";
    const value: WorkerVmState = { state, checked_at: checkedAt };
    cachedVmState = { value, at: Date.now() };
    return value;
  } catch {
    cachedVmState = null;
    return { state: "unknown", checked_at: checkedAt };
  }
}

/**
 * Wakes the paused Freestyle worker VM before a user-triggered task.
 *
 * The worker pauses itself after an idle window. A paused VM resumes with the
 * old process state, so the worker immediately claims whatever was just queued:
 * the run is created *before* this call, so no container restart is needed.
 * (The old implementation restarted the container through `exec-await`, which
 * routinely timed out while the VM was still booting and made every ask wait
 * for 30–90 seconds.)
 *
 * A wake failure never loses the queued run: it stays queued until the worker
 * comes back.
 */
export async function wakeWorker(): Promise<WakeResult> {
  const key = process.env.FREESTYLE_API_KEY;
  const vmId = process.env.FREESTYLE_VM_ID;
  if (!key || !vmId) return "not_configured";
  const vmPath = `/v5/vms/${encodeURIComponent(vmId)}`;
  try {
    const stateResponse = await freestyleFetch(vmPath, { method: "GET" }, 8000);
    if (!stateResponse.ok) return "failed";
    const vm = (await stateResponse.json()) as VmState;
    const state = vm?.state;
    if (state === "running") return "already_running";
    if (state === "starting") return "starting";
    const startResponse = await freestyleFetch(`${vmPath}/start`, { method: "POST" }, 25000);
    if (!startResponse.ok && startResponse.status !== 409) return "failed";
    return "started";
  } catch (error) {
    console.error("[freestyle] wake failed", error instanceof Error ? error.name : "unknown");
    return "failed";
  }
}
