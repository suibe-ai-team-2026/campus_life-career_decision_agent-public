/**
 * Server-side environment validation. Browser code must only use NEXT_PUBLIC_*.
 * Never import this module from a client component.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`missing_env:${name}`);
  }
  return value;
}

export function optionalEnv(name: string): string | null {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : null;
}

export function supabaseUrl(): string {
  return requireEnv("NEXT_PUBLIC_SUPABASE_URL");
}

export function supabasePublishableKey(): string {
  return requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
}

export function supabaseSecretKey(): string {
  return requireEnv("SUPABASE_SECRET_KEY");
}

export function appUrl(): string {
  return optionalEnv("NEXT_PUBLIC_APP_URL") ?? "http://127.0.0.1:3000";
}
