"""统一表达层（Voice & Confidence）：自信、确定、具体、去 AI 味。

事实层不变：数字/结论仍然只能来自规则事实与证据，引用编号仍然可回溯；
本模块只统一「怎么说」，供提示词、确定性兜底文案、后处理与前端文案共用。

设计依据：
- 团队 2026-11-05 反馈：已归档资料来自官网，不再逐条标注「待核验／部分核验」；
  整个产品去掉「过分谨慎」的防御式语气；见 docs/voice-and-confidence.md。
- [no-ai-slop](https://github.com/petergyang/no-ai-slop) 的编辑规则（禁用词、二元对比、
  铺垫开场、伪洞察、总结回扣、元评论、格式 slop），按中文语境重写。

用法::

    from .voice import VOICE_CONTRACT, SCOPE_PREFIX, sanitize_prose, find_hedges

    SYSTEM_PROMPT = f"...任务...\\n\\n{VOICE_CONTRACT}"
    answer = sanitize_prose(raw_answer)
    assert not find_hedges(deterministic_fallback_text)
"""

from __future__ import annotations

import re

# ---------------------------------------------------------------------------
# 提示词表达契约（拼进每个 system prompt）
# ---------------------------------------------------------------------------

VOICE_CONTRACT = """## 表达契约（与事实规则同等重要，逐条执行）
你在给一个正在做真实决策的大学生写东西。读完，他要能立刻说出：结论是什么、依据是什么、下一步做什么。
1. 结论先行。第一句直接给判断或答案；不铺垫、不自我介绍、不复述问题。
2. 确定语气。已归档资料是团队核对过的资产，直接陈述事实与判断。用「是／可以／优先／先做／到这里查」
   这类明确动词。禁止写「资料不足」「缺少相关数据」「待进一步核验」「待核验」「部分核验」「未核验」
   「仅供参考」「样本有限」「不能外推」「覆盖不均衡」这类自我削弱的话。
3. 依据紧随其后。事实句用 [n] 标注证据编号，编号只能来自本次给出的证据。
4. 适用范围只说一次。在全文最后用一行「适用范围：……」交代届别、口径或时点，一句话结束。
   不要把它写成缺陷清单，也不要重复免责声明。
5. 具体。写清对象、时间、入口、动作和判断标准；禁止「进一步了解」「持续提升」「综合考虑」「多方了解」
   这类空话。
6. 去 AI 味。禁止二元对比（"不是 X，而是 Y"）、铺垫开场（"需要说明的是""值得一提的是"）、
   伪洞察（"很多人不知道的是""真正关键的是"）、总结回扣（"综上所述""总的来说"）、
   元评论（"值得注意的是""这一点很重要"）、emoji、装饰性加粗、破折号堆叠。
   不要堆同一种句式，不要每段都写成"观点-解释-总结"。
7. 不编造。没有证据的数字、来源、结论一律不写。资料没覆盖或数据尚未产生时，用一句
   "要等 X 之后才有"说清时点，不写"没有/无法/缺少/未收录"；紧接着给最近可对照的已归档数据，
   再给"到什么入口、按什么口径可以拿到"的可执行路径，语气保持确定。
8. 不暴露内部标识。正文里不写 action_id、缺口 code、字段名或英文内部编号
   （如 verify-credits、credit_rules_unavailable、data_unavailable、credits），
   行动与核对项一律用中文名称指代；用户不该看到系统内部的键名。"""

# 适用范围行的统一前缀（一句话收口）
SCOPE_PREFIX = "适用范围："

# 模型回答命中自我削弱表达时的修复指令：只改语气，不动事实/数字/[n] 引用。
VOICE_REPAIR_INSTRUCTION = """【表达修复】上面这段回答命中了自我削弱表达：{phrases}。
请在保持事实、数字与 [n] 引用完全不变的前提下重写一版：
1. 第一句直接给结论/判断，不再铺垫；
2. 删掉「资料不足」「待核验」「未核验」「部分核验」「仅供参考」「不能外推」这类说法；
3. 资料没覆盖的部分，改成「到什么入口、按什么口径可以拿到」的可执行路径；
4. 文末保留一行「适用范围：……」。
按原有 JSON 结构只输出一个 JSON 对象。需要重写的原文：
{text}"""

# ---------------------------------------------------------------------------
# 禁用表达（提示词、后处理、前端文案、测试共用一份）
# ---------------------------------------------------------------------------

# 自我削弱/防御式表达：出现在用户可见文案里即视为不合格。
HEDGE_PHRASES: tuple[str, ...] = (
    "资料不足",
    "资料尚不足",
    "没有归档数据",
    "没有相关数据",
    "没有可引用",
    "暂无数据",
    "暂无资料",
    "无法给出",
    "无法提供具体",
    "未收录",
    "资料缺口",
    "缺少相关数据",
    "缺少相关资料",
    "缺少可核验",
    "不足以支撑",
    "不足以生成",
    "无法基于已归档资料",
    "待进一步核验",
    "待核验",
    "部分核验",
    "未核验",
    "尚未核验",
    "未经核验",
    "仅供参考",
    "样本有限",
    "不能外推",
    "不能保证",
    "可能不准确",
    "覆盖不均衡",
    "不构成就业承诺",
    "不构成",
    "免责声明",
)

# AI 腔/空话词汇。
SLOP_TERMS: tuple[str, ...] = (
    "深入探讨",
    "赋能",
    "助力",
    "全方位",
    "多维度",
    "一站式",
    "无缝",
    "颠覆",
    "革新",
    "范式",
    "生态位",
    "闭环",
    "抓手",
    "底层逻辑",
    "降维打击",
    "极致",
    "王炸",
    "重磅",
    "里程碑",
    "划时代",
    "至关重要",
    "意义深远",
    "彰显",
    "凸显",
    "值得注意",
    "综上所述",
    "总而言之",
    "总的来说",
    "归根结底",
    "众所周知",
    "毋庸置疑",
    "客观来说",
    "从某种意义上说",
    "需要说明的是",
    "值得一提的是",
    "需要指出的是",
    "很多人不知道",
    "大多数人都忽略",
    "真正关键的是",
)

# 中文 slop 句式 → 直接删除（只删修辞，不引入任何新事实/数字）。
# 顺序有意义：先处理长句式，再处理短语。
_SLOP_REWRITES: tuple[tuple[re.Pattern[str], str], ...] = (
    # 二元对比 / 否定列举："不是 A，而是 B" → 直接留 B
    (re.compile(r"(?:并)?不是[^。；！？\n]{1,48}[，,]\s*(?:而|正)是"), ""),
    (re.compile(r"并非[^。；！？\n]{1,48}[，,]\s*而是"), ""),
    (re.compile(r"不仅[^。；！？\n]{1,48}[，,]\s*更是"), ""),
    # 铺垫开场
    (re.compile(r"(?:^|(?<=[。；！？\n]))\s*(?:需要说明的是|值得一提的是|需要指出的是|不得不说的是|客观来说|客观地讲|从某种意义上说|众所周知|毋庸置疑|毫无疑问|显而易见)[，,]\s*"), ""),
    # 伪洞察
    (re.compile(r"(?:^|(?<=[。；！？\n]))\s*(?:很多人不知道的是|大多数人都忽略了|很少有人注意到)[，,]\s*"), ""),
    # 总结回扣
    (re.compile(r"(?:^|(?<=[。；！？\n]))\s*(?:综上所述|总而言之|总的来说|归根结底|由此可见)[，,]\s*"), ""),
    # 元评论
    (re.compile(r"(?:^|(?<=[。；！？\n]))\s*(?:值得注意的是|这一点很重要)[，,]\s*"), ""),
    # 表层分析：", 体现了……的承诺/决心/价值" 之类的尾巴
    (re.compile(r"[，,]\s*(?:体现|彰显|展现|凸显|印证)了[^。；\n]{0,40}(?:承诺|决心|实力|价值|意义|担当)"), ""),
    # 重要性吹捧
    (re.compile(r"(?:具有|有着)?(?:里程碑|划时代)(?:式)?(?:的)?意义"), ""),
    (re.compile(r"(?:发挥|起到)着?(?:至关重要的|关键的|核心的)作用"), ""),
    # 空泛建议
    (re.compile(r"(?:进一步了解|持续提升|综合考虑|多方了解|结合自身情况)(?:一下)?"), ""),
)

# 多标点收敛：删词后可能留下 "，，" / "。。" / 多余空格。
_PUNCT_FIX: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"[，,]{2,}"), "，"),
    (re.compile(r"[。；！？]{2,}"), "。"),
    (re.compile(r"^[，,；：、\s]+"), ""),
    (re.compile(r"[ \t]{2,}"), " "),
    (re.compile(r"[ \t]+([，。；：！？])"), r"\1"),
)


def find_hedges(text: str | None) -> list[str]:
    """返回文本里命中的自我削弱表达（用于测试与遥测）。"""

    if not text:
        return []
    return [phrase for phrase in HEDGE_PHRASES if phrase in text]


def find_slop(text: str | None) -> list[str]:
    """返回文本里命中的 AI 腔词汇（用于测试与遥测）。"""

    if not text:
        return []
    return [term for term in SLOP_TERMS if term in text]


# 引用标记 [n] / [1,2] / [1，2]；其它方括号内容基本都是模型泄漏的内部实体 id
# （如 ``[competition-lead-trade_supply_chain-1]``），展示给用户只会像乱码。
_BRACKET_RE = re.compile(r"\[([^\[\]\n]{0,120})\]")
# 内部标识：action_id（verify-*）与 gap/字段 code（snake_case 英文）。
_INTERNAL_ID_RE = re.compile(
    r"(?<![A-Za-z0-9_])(?:verify-[a-z][a-z0-9-]*|[a-z][a-z0-9]*_[a-z0-9_]+)(?![A-Za-z0-9_])"
)
_CITATION_INNER_RE = re.compile(r"\d{1,3}(?:\s*[,，、]\s*\d{1,3})*")
_SCOPE_LINE_RE = re.compile(r"(?m)^\s*适用范围[:：].*$")


def _drop_internal_bracket_tokens(text: str) -> str:
    """保留 [n] 引用，删掉其它方括号里的内部 id / 规则键。"""

    def replace(match: re.Match[str]) -> str:
        inner = match.group(1).strip()
        if _CITATION_INNER_RE.fullmatch(inner):
            return match.group(0)
        return ""

    return _BRACKET_RE.sub(replace, text)


def sanitize_prose(text: str | None) -> str:
    """清理模型/兜底文案里的 slop 句式、内部 id 与多余标点。

    只做删除与标点收敛，不新增任何事实、数字或来源；引用标记 ``[n]`` 保持原样。
    """

    if not text:
        return ""
    cleaned = _drop_internal_bracket_tokens(text)
    cleaned = _INTERNAL_ID_RE.sub("", cleaned)
    for pattern, replacement in _SLOP_REWRITES:
        cleaned = pattern.sub(replacement, cleaned)
    for pattern, replacement in _PUNCT_FIX:
        cleaned = pattern.sub(replacement, cleaned)
    # 逐行去首尾空白，保留段落结构。
    lines = [line.strip() for line in cleaned.splitlines()]
    return "\n".join(lines).strip()


# 句子边界：中文句号/问号/叹号/分号。只删整句，不在句内做改写。
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[。！？!?；;])")


def scrub_hedges(text: str | None) -> str:
    """删除含自我削弱表达的整句/分句，只删不改写，不新增任何事实。

    用于模型输出兜底：``sanitize_prose`` 只处理 AI 腔，这里负责"资料不足/待核验"
    这类防御式表达；删除后若整段为空，调用方应改用确定性自信文案。
    """

    if not text:
        return ""
    kept_lines: list[str] = []
    for line in text.splitlines():
        if not line.strip():
            kept_lines.append("")
            continue
        pieces = _SENTENCE_SPLIT_RE.split(line)
        kept = [piece for piece in pieces if piece.strip() and not find_hedges(piece)]
        kept_lines.append("".join(kept).strip())
    return "\n".join(kept_lines).strip()


def apply_scope_line(body: str, scope: str) -> str:
    """把适用范围收口成正文最后一行，且全文只保留一行。

    模型经常在正文里自带一行「适用范围：……」；这里先删掉正文里的旧行，再统一
    追加调用方给的 canonical 版本，避免同一句话在页面上出现两次。
    """

    scope = (scope or "").strip()
    body = (body or "").rstrip()
    if not scope:
        return body
    line = scope if scope.startswith(SCOPE_PREFIX) else f"{SCOPE_PREFIX}{scope}"
    body = _SCOPE_LINE_RE.sub("", body)
    body = re.sub(r"\n{3,}", "\n\n", body).strip()
    return f"{body}\n{line}" if body else line
