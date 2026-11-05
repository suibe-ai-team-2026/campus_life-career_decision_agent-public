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
from typing import Any, Mapping, Sequence

from ..errors import ModelOutputInvalid, OutputValidationError
from .voice import SCOPE_PREFIX, sanitize_prose, scrub_hedges

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

# 每个话题对应的官方查证入口：兜底回答用"到哪查"替代"资料不足"。
TOPIC_ROUTES = {
    "policy": "学校教务处官网「规章制度 / 通知公告」栏，按文件类型与届别检索",
    "job": "目标企业官网或校园招聘页的岗位说明（JD），记录发布时间与岗位要求",
    "plan": "学院官网与教务处培养方案页，查当学期课程、实习与实践安排",
    "case": "学校就业信息网的就业质量年度报告，查分届别毕业生去向",
    "catalog": "教务系统「培养方案」页，按专业和年级查课程、学分与开课学期",
    "official": "学校就业信息网或「就业质量年度报告」，查分届别统计口径与分母",
}
DEFAULT_ROUTE = "学校教务处官网与学院官网，按「专业 + 年级 + 文件类型」检索"


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
        answer=sanitize_prose(answer),
        citation_numbers=citations,
        no_evidence=no_evidence,
        boundary_note=sanitize_prose(boundary_note),
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
        explanation=sanitize_prose(explanation),
        cited_action_ids=cited_action_ids,
        citation_numbers=citations,
        boundary_note=sanitize_prose(boundary_note),
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
    cleaned_notes = {
        dimension: scrub_hedges(sanitize_prose(descriptive)) for dimension, descriptive in notes.items()
    }
    return AssessmentExplanation(
        explanation=scrub_hedges(sanitize_prose(explanation)),
        dimension_notes={key: value for key, value in cleaned_notes.items() if value},
        boundary_note=sanitize_prose(boundary_note),
    )


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
        comparison=scrub_hedges(sanitize_prose(comparison)),
        citation_numbers=citations,
        boundary_note=sanitize_prose(str(payload.get("boundary_note") or "").strip()[:500]),
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
    """兜底回答：不写"资料不足"，直接给覆盖范围与官方查证路径。

    只使用问题里的届别/话题与本次证据标题，不新增任何事实或数字。
    """

    topics = detected_topics(question)
    cohorts = detected_cohorts(question)
    labels = "、".join(TOPIC_LABELS.get(topic, topic) for topic in topics)
    cohort_label = "、".join(f"{cohort}届" for cohort in cohorts)
    cohort_prefix = f"{cohort_label}的" if cohort_label else ""
    lines = [
        f"结论：{cohort_prefix}{labels or '这个问题'}的权威答案在学校官方文件里，按下面的路径可以直接拿到确定答案。",
    ]
    routes = [TOPIC_ROUTES[topic] for topic in topics if topic in TOPIC_ROUTES] or [DEFAULT_ROUTE]
    lines.append("到哪查：" + "；".join(dict.fromkeys(routes)) + "。")
    if evidence:
        titles = "、".join(f"《{item.get('title', '')}》" for item in list(evidence)[:2])
        lines.append(f"资料库里最接近的资料是{titles}，点开引用卡可以直接看原文与定位。")
    lines.append(f"{SCOPE_PREFIX}{cohort_prefix}口径与届别以学校当年发布的文件为准。")
    return "\n".join(lines)


def build_boundary_note(question: str, *, gate_version: str = "") -> str:
    """一句适用范围：届别、话题分类与检索闸门版本，没有则不写。"""

    cohorts = detected_cohorts(question)
    topics = detected_topics(question)
    pieces: list[str] = []
    if cohorts:
        pieces.append("、".join(f"{cohort}届" for cohort in cohorts))
    if topics:
        pieces.append("、".join(TOPIC_LABELS.get(topic, topic) for topic in topics) + "类官方资料")
    if gate_version:
        pieces.append(f"检索闸门 {gate_version}")
    return f"{SCOPE_PREFIX}{'；'.join(pieces)}" if pieces else ""


def deterministic_plan_explanation(*, status: str, gap_codes: Sequence[str], reason: str = "") -> str:
    """方案解释兜底：给已确定的方案事实摘要与下一步，不复述模型失败原因。"""

    lines = ["这份方案按规则引擎给出的事实组织：方向、行动、课程与学分都可以直接照着执行。"]
    if status == "data_unavailable":
        lines.append("课程与学分的具体数字到教务系统「培养方案」页按专业和年级核对，确认后回到方案更新。")
    elif status == "partial":
        lines.append("方案里已经确定的部分先执行；需要补充的课程与竞赛信息到教务系统、团委官网核对。")
    if gap_codes:
        lines.append("下一步：按「下一步核对」清单到教务系统 / 学院官网 / 团委逐项确认。")
    lines.append(f"{SCOPE_PREFIX}方向是暂定方向，最终行政认定以学校当年文件为准。")
    return "\n".join(lines)


def deterministic_assessment_explanation() -> str:
    return (
        "这份结果按本次测评系统已计算的维度分数与答题数量给出，分数已经冻结。"
        "每个维度对应一类兴趣或能力倾向，用来确定下一步优先验证的方向。"
        f"{SCOPE_PREFIX}本次自评问卷的作答结果，方向结合课程、实践与顾问判断确定。"
    )


def deterministic_compare_text(directions: Sequence[dict[str, Any]]) -> str:
    titles = "、".join(str(item.get("title") or item.get("direction_id") or "") for item in directions)
    return (
        f"先给结论：{titles} 这几个方向按方向卡直接对比。"
        "对比维度是工作内容、能力要求与下一步核对项；系统不做学校或专业排名。"
        f"{SCOPE_PREFIX}方向卡是产品导航分类，具体岗位与课程以学院官网、培养方案为准。"
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

    def clean_prose(value: str) -> str:
        # 先收敛 AI 腔，再删掉自我削弱的句子；事实/数字/引用已在上面校验过，这里只改语气。
        return scrub_hedges(sanitize_prose(value))

    return PlanAnalysisOutput(
        overview=clean_prose(overview),
        match=clean_prose(match),
        action_rationale=[item for item in (clean_prose(line) for line in action_rationale) if item],
        evidence_courses=evidence_courses,
        evidence_competitions=evidence_competitions,
        risks=[item for item in (clean_prose(line) for line in risks) if item],
        next_steps=[item for item in (clean_prose(line) for line in next_steps) if item],
        citation_numbers=numbers,
        boundary_note=clean_prose(boundary_note),
        validation_reasons=reasons,
    )


# ---------------------------------------------------------------------------
# 方向分析确定性兜底（模型失败时也要有可用内容，不只留一条提示）
# ---------------------------------------------------------------------------

_WINDOW_LABELS = {
    "current_term": "本学期",
    "next_term": "下学期",
    "later": "更晚一些",
}


def deterministic_plan_analysis(
    *,
    profile_facts: Mapping[str, Any],
    rule_facts: Mapping[str, Any],
) -> dict[str, Any]:
    """模型方向分析失败时的确定性替代：只复用画像与规则事实，不新增事实。

    返回结构对齐 ``PlanAnalysisOutput`` 的字段，供 plan 图在降级路径发布。
    """

    signals = profile_facts.get("profile_signals") if isinstance(profile_facts, Mapping) else {}
    signals = signals if isinstance(signals, Mapping) else {}
    interests = list(signals.get("interests_ranked") or [])
    abilities = list(signals.get("abilities_ranked") or [])
    styles = list(signals.get("work_styles") or [])
    experience = signals.get("experience") if isinstance(signals.get("experience"), Mapping) else None
    decision_reason = str(signals.get("decision_reason") or profile_facts.get("decision_reason") or "").strip()

    top_interest = str(interests[0].get("label") or "") if interests else ""
    top_ability = str(abilities[0].get("label") or "") if abilities else ""
    style_label = str(styles[0].get("label") or "") if styles else ""

    actions = [action for action in list(rule_facts.get("actions") or []) if isinstance(action, Mapping)]
    gaps = [gap for gap in list(rule_facts.get("gaps") or []) if isinstance(gap, Mapping)]
    roadmap = [stage for stage in list(rule_facts.get("roadmap") or []) if isinstance(stage, Mapping)]
    focus = str(next((stage.get("focus") for stage in roadmap if stage.get("stage") == "未来 30 天"), "") or "")

    overview_parts = [
        f"按规则事实，这个方向一共有 {len(actions)} 项可执行行动。",
    ]
    if focus:
        overview_parts.append(f"未来 30 天的重点是：{focus}。")
    choices = [
        str(item.get("title") or "")
        for key in ("course_leads", "competition_leads", "industry_leads")
        for item in list(rule_facts.get(key) or [])
        if isinstance(item, Mapping)
    ]
    if choices:
        overview_parts.append("课程、竞赛与岗位线索已整理在「方向与行业」页签，可按线索逐项核对。")
    overview = "".join(overview_parts)

    match_parts = []
    if top_interest and top_ability:
        match_parts.append(f"你的自评里「{top_interest}」与「{top_ability}」排在最前，和这个方向的准备成本直接相关。")
    elif top_ability:
        match_parts.append(f"你的能力自评里「{top_ability}」排在最前，可以先把它写成一份可展示的成果。")
    elif top_interest:
        match_parts.append(f"你的兴趣自评里「{top_interest}」排在最前，适合先从一次真实的实践或课程任务验证。")
    if style_label:
        match_parts.append(f"工作方式偏好是「{style_label}」，执行时按这个节奏安排更容易坚持。")
    if experience and str(experience.get("text") or "").strip():
        match_parts.append("你写下的经历已经可以作为第一份证据，先把它整理成可展示的样例。")
    if decision_reason:
        match_parts.append(f"你写下的暂定理由是「{decision_reason[:80]}」，先用一次小规模实践验证它，再决定是否加码。")
    if not match_parts:
        match_parts.append("画像信号已写入方案；先完成一所一课的核对，再按结果调整方向。")
    match = "".join(match_parts)

    action_rationale = []
    for action in actions:
        title = str(action.get("title") or "").strip()
        if not title:
            continue
        window = _WINDOW_LABELS.get(str(action.get("window") or ""), "")
        prefix = f"{window}完成" if window else "先做"
        action_rationale.append(f"「{title}」：{prefix}，把核对结果写回方案。")

    risks = [str(gap.get("message") or "").strip() for gap in gaps if str(gap.get("message") or "").strip()][:4]
    next_steps = [str(action.get("title") or "").strip() for action in actions if str(action.get("title") or "").strip()][:4]

    return {
        "overview": overview,
        "match": match,
        "action_rationale": action_rationale,
        "evidence_courses": [],
        "evidence_competitions": [],
        "risks": risks,
        "next_steps": next_steps,
        "citation_numbers": [],
        "boundary_note": "方向分析按规则事实与画像生成；课程、学分与认定以学校当年文件为准。",
    }
