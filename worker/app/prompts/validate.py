"""模型输出校验：JSON 提取、引用编号、数字/百分比一致性、越界丢弃。

程序只做机械校验，不判断语义是否正确：
- 引用编号必须存在于本次证据；
- 回答中出现的阿拉伯数字/百分比必须逐字出现在证据（或规则事实）里；
- 事实句必须带引用；不满足就丢弃解释，回退到确定性文案/拒答。
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any, Sequence

from ..errors import ModelOutputInvalid, OutputValidationError

CITE_RE = re.compile(r"\[(\d{1,2})\]")
# 数字 token：排除标识符/版本号内部的数字（前后不能是 ASCII 字母数字或 ._-）。
NUMBER_RE = re.compile(r"(?<![A-Za-z0-9_.\-])(\d[\d,]*(?:\.\d+)?)(\s*[%％])?(?![A-Za-z0-9_.\-])")
CHINESE_PERCENT_RE = re.compile(r"百分之\s*(\d[\d,]*(?:\.\d+)?)")
URL_RE = re.compile(r"https?://[^\s）)\]】\"'，。；;]+", re.IGNORECASE)
# 只有书名号表示"标题/实体"；「」与“”常被模型用来强调描述性短语
# （如「该方向应修哪些课」），把它们当实体校验会把正常解释整段否掉。
QUOTED_ENTITY_RE = re.compile(r"《([^》\n]{1,80})》")
SENTENCE_RE = re.compile(r"[^。！？!?\n]+[。！？!?]?")

COHORT_RE = re.compile(r"(20[1-2]\d)\s*届")

TOPIC_LABELS = {
    "policy": "政策/通知",
    "job": "招聘要求（JD 快照）",
    "plan": "行动建议",
    "case": "毕业生案例",
    "catalog": "培养方案/课程目录",
    "official": "官方统计（就业质量报告等）",
    "research": "团队研究归纳",
}

TOPIC_TRIGGERS = {
    "policy": ("政策", "通知", "意见", "办法", "规定", "部署", "举措"),
    "job": ("招聘", "岗位", "jd", "技能", "证书", "实习", "求职"),
    "plan": ("怎么准备", "如何准备", "下一步", "行动", "规划", "建议"),
    "case": ("学长", "学姐", "案例", "经历", "自述", "转行"),
    "catalog": ("培养方案", "课程", "学分", "目录", "开课"),
    "official": ("就业率", "去向", "落实率", "人数", "比例", "统计"),
}


def extract_json_object(content: str) -> dict[str, Any]:
    """从模型输出中提取 JSON 对象；容忍 ```json 围栏与前后解释文字。"""

    text = (content or "").strip()
    if not text:
        raise ModelOutputInvalid("模型返回空内容")
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start < 0 or end <= start:
            raise ModelOutputInvalid("模型输出不是 JSON 对象")
        try:
            payload = json.loads(text[start : end + 1])
        except json.JSONDecodeError as exc:
            raise ModelOutputInvalid("模型输出的 JSON 无法解析") from exc
    if not isinstance(payload, dict):
        raise ModelOutputInvalid("模型输出的 JSON 顶层不是对象")
    return payload


def normalize_number_token(raw_number: str, percent_marker: str | None) -> str:
    number = raw_number.replace(",", "")
    if number.endswith(".0"):
        number = number[:-2]
    return f"{number}%" if percent_marker else number


def number_tokens(text: str) -> list[str]:
    """抽取文本中的数字/百分比 token（跳过 [n] 引用标记与标识符内数字）。"""

    without_citations = CITE_RE.sub(" ", text or "")
    tokens: list[str] = []
    for match in NUMBER_RE.finditer(without_citations):
        tokens.append(normalize_number_token(match.group(1), match.group(2)))
    for match in CHINESE_PERCENT_RE.finditer(without_citations):
        tokens.append(normalize_number_token(match.group(1), "%"))
    return tokens


def allowed_number_tokens(allowed_texts: Sequence[str]) -> set[str]:
    allowed: set[str] = set()
    for text in allowed_texts:
        allowed.update(number_tokens(text))
    return allowed


def _canonical_number(token: str) -> tuple[str, Decimal] | None:
    """把数字 token 归一为 (是否百分比, 数值)，用于容忍 95.60% 与 95.6% 等写法差异。"""

    percent = token.endswith("%")
    raw = token[:-1] if percent else token
    try:
        value = Decimal(raw)
    except (InvalidOperation, ValueError):
        return None
    return ("pct" if percent else "num", value)


def validate_numbers(text: str, allowed_texts: Sequence[str]) -> list[str]:
    """返回回答中出现、但证据/规则事实里不存在的数字 token。"""

    allowed = allowed_number_tokens(allowed_texts)
    allowed_canonical = {
        canonical for token in allowed if (canonical := _canonical_number(token)) is not None
    }
    offenders: list[str] = []
    seen: set[str] = set()
    for token in number_tokens(text):
        if token in allowed or token in seen:
            continue
        canonical = _canonical_number(token)
        if canonical is not None and canonical in allowed_canonical:
            continue
        seen.add(token)
        offenders.append(token)
    return offenders


def validate_citation_numbers(numbers: Sequence[int], valid: set[int]) -> list[int]:
    return sorted({int(number) for number in numbers if int(number) not in valid})


def citation_markers(text: str) -> list[int]:
    return [int(value) for value in CITE_RE.findall(text or "")]


def validate_urls(text: str, allowed_urls: Sequence[str]) -> list[str]:
    """回答不得引入证据之外的 URL/来源。"""

    allowed = {url.rstrip("/").lower() for url in allowed_urls if url}
    offenders: list[str] = []
    for match in URL_RE.finditer(text or ""):
        url = match.group(0).rstrip("/").lower()
        if url not in allowed:
            offenders.append(match.group(0))
    return offenders


def sentences_without_citation(text: str) -> list[str]:
    """含数字/百分比的事实句必须带 [n] 引用。"""

    missing: list[str] = []
    for sentence in SENTENCE_RE.findall(text or ""):
        cleaned = sentence.strip()
        if not cleaned:
            continue
        has_number = bool(number_tokens(cleaned))
        if not has_number:
            continue
        if not CITE_RE.search(cleaned):
            missing.append(cleaned[:120])
    return missing


@dataclass
class AskOutput:
    answer: str
    citation_numbers: list[int]
    no_evidence: bool
    boundary_note: str = ""
    validation_reasons: list[str] = field(default_factory=list)


def parse_ask_output(
    raw: str,
    *,
    valid_citations: set[int],
    evidence_texts: Sequence[str],
    allowed_urls: Sequence[str] = (),
) -> AskOutput:
    payload = extract_json_object(raw)
    answer = str(payload.get("answer") or "").strip()
    raw_numbers = payload.get("citation_numbers") or []
    if not isinstance(raw_numbers, list):
        raise OutputValidationError("citation_numbers 必须是数组", reasons=["bad_citation_field"])
    numbers: list[int] = []
    for item in raw_numbers:
        try:
            numbers.append(int(item))
        except (TypeError, ValueError) as exc:
            raise OutputValidationError("citation_numbers 含非整数", reasons=["bad_citation_field"]) from exc
    no_evidence = bool(payload.get("no_evidence"))
    boundary_note = str(payload.get("boundary_note") or "").strip()[:500]
    if not answer:
        raise OutputValidationError("answer 为空", reasons=["empty_answer"])

    reasons: list[str] = []
    citations = list(dict.fromkeys(numbers + citation_markers(answer)))
    invalid = validate_citation_numbers(citations, valid_citations)
    if invalid:
        reasons.append("invalid_citation_numbers:" + ",".join(str(item) for item in invalid))
    if not no_evidence and not citations:
        reasons.append("missing_citations")
    if not no_evidence:
        offenders = validate_numbers(answer, evidence_texts)
        if offenders:
            reasons.append("numbers_not_in_evidence:" + ",".join(offenders[:5]))
        urls = validate_urls(answer, allowed_urls)
        if urls:
            reasons.append("urls_not_in_evidence")
        missing = sentences_without_citation(answer)
        if missing:
            reasons.append(f"numeric_sentences_without_citation:{len(missing)}")
    return AskOutput(
        answer=answer,
        citation_numbers=citations,
        no_evidence=no_evidence,
        boundary_note=boundary_note,
        validation_reasons=reasons,
    )


@dataclass
class PlanExplanation:
    explanation: str
    cited_action_ids: list[str]
    citation_numbers: list[int]
    boundary_note: str
    validation_reasons: list[str] = field(default_factory=list)


def quoted_entities(text: str) -> list[str]:
    """抽取解释里用书名号/引号声明的实体名，用于检查“不得新增实体”。"""

    return [match.group(1).strip() for match in QUOTED_ENTITY_RE.finditer(text or "") if match.group(1).strip()]


def parse_plan_explanation(
    raw: str,
    *,
    valid_citations: set[int],
    action_ids: set[str],
    allowed_texts: Sequence[str],
    allowed_urls: Sequence[str] = (),
    allowed_entity_titles: Sequence[str] = (),
) -> PlanExplanation:
    payload = extract_json_object(raw)
    explanation = str(payload.get("explanation") or "").strip()
    if not explanation:
        raise OutputValidationError("explanation 为空", reasons=["empty_explanation"])
    cited_ids = payload.get("cited_action_ids") or []
    if not isinstance(cited_ids, list):
        raise OutputValidationError("cited_action_ids 必须是数组", reasons=["bad_field"])
    cited_action_ids = [str(item) for item in cited_ids]
    raw_numbers = payload.get("citation_numbers") or []
    if not isinstance(raw_numbers, list):
        raise OutputValidationError("citation_numbers 必须是数组", reasons=["bad_field"])
    numbers: list[int] = []
    for item in raw_numbers:
        try:
            numbers.append(int(item))
        except (TypeError, ValueError) as exc:
            raise OutputValidationError("citation_numbers 含非整数", reasons=["bad_field"]) from exc
    boundary_note = str(payload.get("boundary_note") or "").strip()[:500]

    reasons: list[str] = []
    unknown_actions = sorted({action_id for action_id in cited_action_ids if action_id not in action_ids})
    if unknown_actions:
        reasons.append("unknown_action_ids:" + ",".join(unknown_actions[:5]))
    citations = list(dict.fromkeys(numbers + citation_markers(explanation)))
    invalid = validate_citation_numbers(citations, valid_citations)
    if invalid:
        reasons.append("invalid_citation_numbers:" + ",".join(str(item) for item in invalid))
    offenders = validate_numbers(explanation, allowed_texts)
    if offenders:
        reasons.append("numbers_not_in_facts:" + ",".join(offenders[:5]))
    urls = validate_urls(explanation, allowed_urls)
    if urls:
        reasons.append("urls_not_in_facts")
    # 解释里用书名号/引号声明的实体必须来自规则事实或证据（防止在散文里新增课程/竞赛）。
    corpus = "\n".join([*allowed_entity_titles, *allowed_texts])
    unknown_entities = [entity for entity in quoted_entities(explanation) if entity not in corpus]
    if unknown_entities:
        reasons.append("unknown_entities:" + ",".join(unknown_entities[:5]))
    return PlanExplanation(
        explanation=explanation,
        cited_action_ids=cited_action_ids,
        citation_numbers=citations,
        boundary_note=boundary_note,
        validation_reasons=reasons,
    )


@dataclass
class AssessmentExplanation:
    explanation: str
    dimension_notes: dict[str, str]
    boundary_note: str


def parse_assessment_explanation(raw: str, *, valid_dimensions: set[str]) -> AssessmentExplanation:
    payload = extract_json_object(raw)
    explanation = str(payload.get("explanation") or "").strip()
    notes_raw = payload.get("dimension_notes") or []
    notes: dict[str, str] = {}
    if isinstance(notes_raw, list):
        for item in notes_raw:
            if not isinstance(item, dict):
                continue
            dimension = str(item.get("dimension") or "").strip()
            descriptive = str(item.get("descriptive") or "").strip()[:500]
            # 只接受系统已有的维度；模型输出里的分数一律忽略。
            if dimension in valid_dimensions and descriptive:
                notes[dimension] = descriptive
    boundary_note = str(payload.get("boundary_note") or "").strip()[:500]
    return AssessmentExplanation(explanation=explanation, dimension_notes=notes, boundary_note=boundary_note)


@dataclass
class CompareExplanation:
    comparison: str
    citation_numbers: list[int]
    boundary_note: str
    validation_reasons: list[str] = field(default_factory=list)


def parse_compare_explanation(
    raw: str,
    *,
    valid_citations: set[int],
    allowed_texts: Sequence[str],
) -> CompareExplanation:
    payload = extract_json_object(raw)
    comparison = str(payload.get("comparison") or "").strip()
    if not comparison:
        raise OutputValidationError("comparison 为空", reasons=["empty_comparison"])
    raw_numbers = payload.get("citation_numbers") or []
    numbers: list[int] = []
    if isinstance(raw_numbers, list):
        for item in raw_numbers:
            try:
                numbers.append(int(item))
            except (TypeError, ValueError):
                continue
    citations = list(dict.fromkeys(numbers + citation_markers(comparison)))
    reasons: list[str] = []
    invalid = validate_citation_numbers(citations, valid_citations)
    if invalid:
        reasons.append("invalid_citation_numbers:" + ",".join(str(item) for item in invalid))
    offenders = validate_numbers(comparison, allowed_texts)
    if offenders:
        reasons.append("numbers_not_in_facts:" + ",".join(offenders[:5]))
    return CompareExplanation(
        comparison=comparison,
        citation_numbers=citations,
        boundary_note=str(payload.get("boundary_note") or "").strip()[:500],
        validation_reasons=reasons,
    )


# ---------------------------------------------------------------------------
# 确定性兜底文案（不引入资料之外的事实）
# ---------------------------------------------------------------------------


def detected_topics(question: str) -> list[str]:
    lowered = (question or "").lower()
    return [topic for topic, triggers in TOPIC_TRIGGERS.items() if any(trigger in lowered for trigger in triggers)]


def detected_cohorts(question: str) -> list[str]:
    return sorted(set(COHORT_RE.findall(question or "")))


def build_refusal_text(
    question: str,
    *,
    evidence: Sequence[dict[str, Any]] = (),
    reason: str = "insufficient_evidence",
) -> str:
    topics = detected_topics(question)
    cohorts = detected_cohorts(question)
    parts: list[str] = ["资料不足，无法基于已归档资料安全回答这个问题。"]
    missing: list[str] = []
    if topics:
        labels = "、".join(TOPIC_LABELS.get(topic, topic) for topic in topics)
        missing.append(f"{'、'.join(cohorts) + '的' if cohorts else ''}{labels}类可核验内容")
    else:
        missing.append(f"{'、'.join(cohorts) + '的' if cohorts else ''}能直接支持该问题的已归档资料")
    parts.append("当前语料缺少：" + "；".join(missing) + "。")
    if evidence:
        titles = "、".join(f"《{item.get('title', '')}》" for item in list(evidence)[:2])
        parts.append(f"已检索到的最接近资料是{titles}，但不足以支撑结论。")
    parts.append("可以把问题限定到具体届别、学校、学历或文件后重试；本轮不会用模型知识补全外部事实。")
    return "\n".join(parts)


def build_boundary_note(question: str, *, gate_version: str = "") -> str:
    cohorts = detected_cohorts(question)
    topics = detected_topics(question)
    pieces: list[str] = []
    if cohorts:
        pieces.append(f"仅覆盖 {'、'.join(cohorts)} 相关可核验资料")
    if topics:
        pieces.append("涉及" + "、".join(TOPIC_LABELS.get(topic, topic) for topic in topics))
    if gate_version:
        pieces.append(f"检索闸门版本 {gate_version}")
    return "资料边界：" + "；".join(pieces) if pieces else ""


def deterministic_plan_explanation(*, status: str, gap_codes: Sequence[str], reason: str = "") -> str:
    lines = [
        "AI 解释未通过引用/数字校验或暂时不可用，已回退为确定性说明；方案事实仍来自规则引擎，未做任何修改。",
    ]
    if status == "data_unavailable":
        lines.append("当前已核验资料不足以生成课程/学分/竞赛结论，因此只列出待核验的核对任务，不给具体数字。")
    elif status == "partial":
        lines.append("部分模块资料尚未核验，方案中已把对应内容标为待核验，请以教务/官方文件为准。")
    if gap_codes:
        lines.append("资料缺口已写入 gaps 字段，可作为下一步核对清单。")
    lines.append("方向只是暂定方向，不是替你做决定；请结合顾问与官方文件核对后再行动。")
    return "\n".join(lines)


def deterministic_assessment_explanation() -> str:
    return (
        "AI 解释暂时不可用，以下仅展示测评系统已计算的维度分数与答题数量。"
        "分数只反映本次自评问卷，不代表能力评价，也不构成专业/职业建议；"
        "请结合自身经历与官方资料判断。"
    )


def deterministic_compare_text(directions: Sequence[dict[str, Any]]) -> str:
    titles = "、".join(str(item.get("title") or item.get("direction_id") or "") for item in directions)
    return (
        f"AI 对比说明暂时不可用。当前可对比的方向为：{titles}。"
        "系统只展示方向卡中的工作内容、能力要求与资料缺口，不做排名，也不替你做决定；"
        "请结合证据与官方资料自行比较。"
    )


@dataclass
class PlanAnalysisOutput:
    overview: str
    match: str
    action_rationale: list[str]
    evidence_courses: list[dict[str, Any]]
    evidence_competitions: list[dict[str, Any]]
    risks: list[str]
    next_steps: list[str]
    citation_numbers: list[int]
    boundary_note: str
    validation_reasons: list[str] = field(default_factory=list)


def parse_plan_analysis(
    raw: str,
    *,
    valid_citations: set[int],
    allowed_texts: Sequence[str],
    allowed_urls: Sequence[str] = (),
) -> PlanAnalysisOutput:
    """解析并机械校验“方向分析”输出。

    课程/竞赛线索的 name 必须逐字出现在证据正文里，防止模型在散文里编造课程名。
    """

    payload = extract_json_object(raw)
    overview = str(payload.get("overview") or "").strip()
    match = str(payload.get("match") or "").strip()
    if not overview or not match:
        raise OutputValidationError("方向分析缺少 overview/match", reasons=["empty_analysis"])

    def str_list(key: str) -> list[str]:
        value = payload.get(key) or []
        if not isinstance(value, list):
            raise OutputValidationError(f"{key} 必须是数组", reasons=["bad_field"])
        return [str(item).strip()[:600] for item in value if str(item).strip()]

    action_rationale = str_list("action_rationale")
    risks = str_list("risks")
    next_steps = str_list("next_steps")

    corpus = "\n".join(str(item) for item in allowed_texts)

    def hint_list(key: str) -> list[dict[str, Any]]:
        value = payload.get(key) or []
        if not isinstance(value, list):
            raise OutputValidationError(f"{key} 必须是数组", reasons=["bad_field"])
        out: list[dict[str, Any]] = []
        for item in value:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()[:200]
            if not name:
                continue
            citation_no = item.get("citation_no")
            try:
                citation_no = int(citation_no)  # type: ignore[assignment]
            except (TypeError, ValueError) as exc:
                raise OutputValidationError(f"{key} 含非整数引用", reasons=["bad_field"]) from exc
            note = str(item.get("note") or "").strip()[:300]
            out.append({"name": name, "citation_no": citation_no, "note": note})
        return out

    evidence_courses = hint_list("evidence_courses")
    evidence_competitions = hint_list("evidence_competitions")

    raw_numbers = payload.get("citation_numbers") or []
    numbers: list[int] = []
    if isinstance(raw_numbers, list):
        for item in raw_numbers:
            try:
                numbers.append(int(item))
            except (TypeError, ValueError):
                pass
    boundary_note = str(payload.get("boundary_note") or "").strip()[:500]

    reasons: list[str] = []
    all_citations = list(dict.fromkeys(numbers + citation_markers(overview) + citation_markers(match)))
    for line in [*action_rationale, *risks, *next_steps]:
        all_citations.extend(citation_markers(line))
    all_citations = list(dict.fromkeys(all_citations))
    invalid = validate_citation_numbers(all_citations, valid_citations)
    if invalid:
        reasons.append("invalid_citation_numbers:" + ",".join(str(item) for item in invalid))

    prose = "\n".join([overview, match, *action_rationale, *risks, *next_steps, boundary_note])
    offenders = validate_numbers(prose, allowed_texts)
    if offenders:
        reasons.append("numbers_not_in_evidence:" + ",".join(offenders[:5]))
    urls = validate_urls(prose, allowed_urls)
    if urls:
        reasons.append("urls_not_in_evidence")

    # 课程/竞赛线索的引用编号与逐字来源校验。
    for kind, hints in (("course", evidence_courses), ("competition", evidence_competitions)):
        for hint in hints:
            if hint["citation_no"] not in valid_citations:
                reasons.append(f"invalid_{kind}_citation:{hint['citation_no']}")
            name = hint["name"]
            if name not in corpus:
                reasons.append(f"unverified_{kind}_name:{name[:40]}")

    return PlanAnalysisOutput(
        overview=overview,
        match=match,
        action_rationale=action_rationale,
        evidence_courses=evidence_courses,
        evidence_competitions=evidence_competitions,
        risks=risks,
        next_steps=next_steps,
        citation_numbers=numbers,
        boundary_note=boundary_note,
        validation_reasons=reasons,
    )
