import { createServerSupabase } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/env";
import { jsonError } from "./respond";

export type AuthedUser = { id: string; isAnonymous: boolean; email: string | null };

/**
 * Reads the current user from the Supabase session cookie. Never accepts a
 * user id from the request body: ownership always comes from auth.uid().
 */
export async function requireUser(): Promise<{ user: AuthedUser } | { response: ReturnType<typeof jsonError> }> {
  if (!supabaseConfigured()) {
    return { response: jsonError("model_unavailable", "云端后端尚未配置，请先使用本地进度") };
  }
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return { response: jsonError("authentication_required", "请先完成匿名或正式登录后再使用云端功能") };
  }
  const user = data.user;
  return {
    user: {
      id: user.id,
      isAnonymous: Boolean(user.is_anonymous),
      email: user.email ?? null
    }
  };
}
