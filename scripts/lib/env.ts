import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Loads local protected env files in Node's native format. Values are never
 * printed. `.env.local` wins; a shared credentials file can be pointed at with
 * CAMPUS_PATHWAY_ENV_FILE.
 */
export function loadLocalEnv() {
  const candidates = [
    process.env.CAMPUS_PATHWAY_ENV_FILE,
    resolve(process.cwd(), ".env.local"),
    resolve(process.cwd(), ".env")
  ].filter((value): value is string => Boolean(value));
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      process.loadEnvFile(file);
    } catch {
      // Ignore malformed optional files; required variables are checked below.
    }
  }
}

export function requireVar(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    console.error(`缺少环境变量 ${name}。请在本地受保护文件或平台 secret 中填写后重试。`);
    process.exit(2);
  }
  return value;
}

export function redact(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
