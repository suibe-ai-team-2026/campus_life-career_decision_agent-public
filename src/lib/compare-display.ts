/**
 * compare 结果的展示辅助。
 *
 * worker 在 AI 输出未通过引用/数字校验时会回退到确定性文案
 * （见 worker/app/prompts/validate.py 的 deterministic_compare_text）。
 * 前端不改写这段文案，只在检测到回退时给出「可重试」的提示，避免用户把
 * 兜底说明误读成 AI 生成的对比结论。
 */

export const COMPARE_FALLBACK_MARKER = "AI 对比说明暂时不可用";

export function isDeterministicCompareFallback(comparison: string): boolean {
  return comparison.trimStart().startsWith(COMPARE_FALLBACK_MARKER);
}
