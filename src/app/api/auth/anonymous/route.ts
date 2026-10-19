import { createServerSupabase } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/env";
import { jsonError, jsonOk } from "@/lib/http/respond";

/**
 * Creates a Supabase anonymous identity on first AI/upload/export request.
 * The user gets a server-side identity and persistent data; this is not a
 * claim that nothing leaves the browser. Passwords and captchas (if enabled)
 * are completed by the user in the official flow.
 */
export async function POST() {
  if (!supabaseConfigured()) {
    return jsonError("model_unavailable", "云端后端尚未配置，当前只能使用本地进度");
  }
  const supabase = await createServerSupabase();
  const current = await supabase.auth.getUser();
  if (current.data.user) {
    return jsonOk({
      user_id: current.data.user.id,
      is_anonymous: Boolean(current.data.user.is_anonymous),
      created: false
    });
  }
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user) {
    return jsonError("authentication_required", "匿名身份创建失败，请稍后重试或改用正式登录");
  }
  return jsonOk({ user_id: data.user.id, is_anonymous: true, created: true });
}
