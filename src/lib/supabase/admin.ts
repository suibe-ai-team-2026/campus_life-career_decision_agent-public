import "server-only";

import { createClient } from "@supabase/supabase-js";
import { supabaseSecretKey, supabaseUrl } from "@/lib/env";

/**
 * Service-role client. Server-only, never exported to a client component.
 * Use only for audited operations: signed upload URLs, verified ingest runs,
 * artifact signing after an ownership check.
 */
export function createAdminSupabase() {
  return createClient(supabaseUrl(), supabaseSecretKey(), {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
  });
}
