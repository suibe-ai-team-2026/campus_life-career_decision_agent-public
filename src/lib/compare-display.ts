/**
 * compare 结果的展示辅助。
 *
 * worker 在 AI 输出未通过引用/数字校验时会回退到确定性文案
 * （见 worker/app/prompts/validate.py 的 deterministic_compare_text）。
 * 前端不改写这段文案，只在检测到回退时给出「可重试」的提示，避免用户把
 * 兜底说明误读成 AI 生成的对比结论。
 */

/**
 * worker 确定性兜底说明的特征句。AI 正常输出不会出现这些整句，因此同时兼容
 * 新旧两版 worker 文案；worker 改文案时只需在这里补一条特征句。
 */
const DETERMINISTIC_COMPARE_SIGNATURES = [
  "AI 对比说明暂时不可用",
  "这几个方向按方向卡直接对比",
  "系统不做学校或专业排名"
] as const;

export const COMPARE_FALLBACK_MARKER = DETERMINISTIC_COMPARE_SIGNATURES[1];

export function isDeterministicCompareFallback(comparison: string): boolean {
  return DETERMINISTIC_COMPARE_SIGNATURES.some((signature) => comparison.includes(signature));
}
