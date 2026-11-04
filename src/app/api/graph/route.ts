import { jsonOk } from "@/lib/http/respond";
import { graphSnapshot } from "@/lib/graph";

export const dynamic = "force-static";
export const revalidate = false;

/**
 * 只读图谱快照：页面在构建期直接用同一份数据，这个接口给后续联动
 * （资料库引用、方案线索卡定位）与外部演示使用。
 */
export async function GET() {
  return jsonOk({ graph: graphSnapshot });
}
