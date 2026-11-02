"""参考数据层：上经贸就业事实、培养方案课程、竞赛目录、校内资源。

数据由团队收集/整理，存放在 ``worker/app/reference_data/*.json``：
- employment.json  就业事实（带来源、届别、口径、引文）
- curriculum.json  培养方案课程（按专业）
- competitions.json 竞赛目录（含学校奖励清单 A/B/C 等级）
- major-map.json   专业别名 → 方向/竞赛映射
- resources.json   校内与外部入口
- schools.json     学校清单

设计原则：
1. 数据缺失时返回空集合，planning 仍能回退到方向通用线索，不抛错。
2. 每条数据自带来源与核验状态；不在这里编造任何数字。
3. 只做确定性筛选/排序，解释交给模型（与规则引擎分工一致）。
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Mapping, Sequence

DATA_DIR = Path(__file__).with_name("reference_data")
REFERENCE_VERSION = "career-reference-2026-11-02"

VERIFICATION_MAP = {
    "pending": "pending_verification",
    "pending_verification": "pending_verification",
    "official_lead": "official_lead",
    "external_reference": "external_reference",
    "known": "known",
    "data_missing": "data_missing",
}

GRADE_ORDER = ["大一", "大二", "大三", "大四"]


def _read_json(name: str, default: Any) -> Any:
    path = DATA_DIR / name
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


@lru_cache(maxsize=1)
def load() -> dict[str, Any]:
    """Load and cache every reference dataset (missing files degrade to empty)."""
    schools_doc = _read_json("schools.json", {})
    employment_doc = _read_json("employment.json", {})
    curriculum_doc = _read_json("curriculum.json", {})
    competitions_doc = _read_json("competitions.json", {})
    major_doc = _read_json("major-map.json", {})
    resources_doc = _read_json("resources.json", {})
    graduate_doc = _read_json("graduate_recommendation.json", {})
    return {
        "schools": list(schools_doc.get("schools") or []),
        "facts": list(employment_doc.get("facts") or []),
        "coverage": list(employment_doc.get("coverage") or []),
        "curricula": list(curriculum_doc.get("majors") or []),
        "fallback_courses": dict(curriculum_doc.get("fallback_courses") or {}),
        "competitions": list(competitions_doc.get("competitions") or []),
        "major_map": list(major_doc.get("majors") or []),
        "major_aliases": dict(major_doc.get("major_aliases") or {}),
        "direction_defaults": dict(major_doc.get("direction_defaults") or {}),
        "resources": list(resources_doc.get("resources") or []),
        "graduate": graduate_doc if isinstance(graduate_doc, dict) else {},
    }


def _norm(value: Any) -> str:
    return str(value or "").strip().lower()


def _verification(value: Any) -> str:
    return VERIFICATION_MAP.get(str(value or "").strip(), "pending_verification")


def _url(value: Any) -> str | None:
    text = str(value or "").strip()
    return text if text.startswith("http://") or text.startswith("https://") else None


def school_id(profile: Mapping[str, Any]) -> str:
    name = str(profile.get("school") or "")
    for school in load()["schools"]:
        if school.get("name") and str(school["name"]) in name:
            return str(school.get("school_id") or "suibe")
    return "suibe"


def resolve_major(major: Any) -> dict[str, Any] | None:
    text = str(major or "").strip()
    if not text:
        return None
    entries = list(load()["major_map"])
    # Longest alias first so 「国际经济与贸易（全英语）」 beats 「国际经济与贸易」.
    def aliases(entry: Mapping[str, Any]) -> list[str]:
        return [str(entry.get("major_name") or ""), *[str(item) for item in entry.get("aliases") or []]]

    for entry in sorted(entries, key=lambda item: -max((len(item) for item in aliases(item)), default=0)):
        if any(alias and alias in text for alias in aliases(entry)):
            return entry
    for alias, major_key in sorted(load()["major_aliases"].items(), key=lambda item: -len(item[0])):
        if alias and alias in text:
            return {"major_key": major_key, "major_name": text, "aliases": [alias], "direction_ids": []}
    return None


def match_curriculum(major: Any) -> dict[str, Any] | None:
    """Pick the closest 培养方案 entry for a free-text major name."""
    text = str(major or "").strip()
    if not text:
        return None
    best: tuple[float, dict[str, Any]] | None = None
    for entry in load()["curricula"]:
        name = str(entry.get("major_name") or "").strip()
        if not name:
            continue
        score = 0.0
        if name == text:
            score = 100.0
        elif name in text or text in name:
            score = 80.0
        elif any(str(alias).strip() == text or (str(alias).strip() and (str(alias).strip() in text or text in str(alias).strip())) for alias in entry.get("aliases") or []):
            score = 70.0
        if not score:
            continue
        if "全英语" in text and "全英语" in name:
            score += 10.0
        if "中加" in text and "中加" in name:
            score += 6.0
        try:
            score += float(entry.get("cohort_year") or 0) / 10000.0
        except (TypeError, ValueError):
            pass
        if best is None or score > best[0]:
            best = (score, entry)
    return best[1] if best else None


def grade_label(profile: Mapping[str, Any]) -> str | None:
    try:
        enrollment_year = int(profile.get("enrollment_year"))
    except (TypeError, ValueError):
        return None
    current_term = str(profile.get("current_term") or "")
    try:
        calendar_year = int(current_term[:4])
    except ValueError:
        calendar_year = enrollment_year
    academic_start = calendar_year if "秋" in current_term else calendar_year - 1
    index = max(0, min(4, academic_start - enrollment_year))
    return GRADE_ORDER[index] if index < len(GRADE_ORDER) else None


def _profile_skills(profile: Mapping[str, Any]) -> set[str]:
    """Ability self-scores plus experience tags; used only to rank competitions."""
    scores = profile.get("scores")
    scores = scores if isinstance(scores, Mapping) else {}
    labels = {
        "research": "研究",
        "data": "数据",
        "writing": "写作",
        "communication": "沟通",
        "execution": "执行",
        "digital": "数字工具",
    }
    result: set[str] = set()
    for key, label in labels.items():
        try:
            if float(scores.get(f"ability_{key}")) >= 3.0:
                result.add(label)
        except (TypeError, ValueError):
            continue
    answers = profile.get("answers")
    answers = answers if isinstance(answers, Mapping) else {}
    experience = answers.get("exp_optional")
    experience = experience if isinstance(experience, Mapping) else {}
    tag_labels = {
        "ability_research": "研究",
        "ability_data": "数据",
        "ability_writing": "写作",
        "ability_communication": "沟通",
        "ability_execution": "执行",
        "ability_digital": "数字工具",
    }
    for tag in experience.get("tags") or []:
        label = tag_labels.get(str(tag))
        if label:
            result.add(label)
    return result


def _course_direction_match(course: Mapping[str, Any], direction_id: str) -> bool:
    dirs = course.get("direction_ids") or []
    return not dirs or direction_id in dirs


def course_leads(profile: Mapping[str, Any], direction_id: str, limit: int = 6) -> list[dict[str, Any]]:
    """Courses from the student's own major; falls back to direction-generic courses."""
    major = resolve_major(profile.get("major"))
    entry = match_curriculum(profile.get("major"))
    major_name = str((entry or {}).get("major_name") or (major or {}).get("major_name") or profile.get("major") or "")
    leads: list[dict[str, Any]] = []
    if entry:
            source = entry.get("source") or {}
            for course in entry.get("courses") or []:
                if not _course_direction_match(course, direction_id):
                    continue
                leads.append(
                    {
                        "title": str(course.get("name") or "").strip(),
                        "description": str(course.get("note") or course.get("description") or "").strip()
                        or "本专业培养方案中的课程线索；学分与开课学期以教务处当年方案为准。",
                        "credits": course.get("credits"),
                        "terms": list(course.get("terms") or []),
                        "nature": str(course.get("nature") or ""),
                        "skills": list(course.get("skills") or []),
                        "source_title": str(source.get("title") or "培养方案"),
                        "source_url": _url(source.get("url")),
                        "locator": str(source.get("locator") or ""),
                        "major_name": str(entry.get("major_name") or major_name),
                        "verification": _verification(entry.get("verification_status") or "official_lead"),
                    }
                )
    if leads:
        return _dedupe(leads, "title")[:limit]
    # Fallback: direction-generic course leads, explicitly marked as generic.
    for course in load()["fallback_courses"].get(direction_id) or []:
        leads.append(
            {
                "title": str(course.get("name") or "").strip(),
                "description": str(course.get("note") or "方向通用课程线索；具体课程以本专业培养方案为准。"),
                "credits": course.get("credits"),
                "terms": list(course.get("terms") or []),
                "nature": "",
                "skills": list(course.get("skills") or []),
                "source_title": "知途方向课程线索（团队整理）",
                "source_url": None,
                "locator": "",
                "major_name": major_name,
                "verification": "pending_verification",
            }
        )
    return _dedupe(leads, "title")[:limit]


def _official_level_score(level: Any) -> int:
    return {"A": 3, "B": 2, "C": 1}.get(str(level or "").strip().upper(), 0)


def _competition_score(competition: Mapping[str, Any], profile: Mapping[str, Any], direction_id: str) -> int:
    score = _official_level_score((competition.get("school_recognition") or {}).get("official_level"))
    if direction_id in (competition.get("direction_ids") or []):
        score += 2
    skills = set(str(item) for item in competition.get("skill_tags") or [])
    score += len(skills & _profile_skills(profile))
    categories = " ".join(str(item) for item in competition.get("categories") or [])
    if "创新创业" in categories:
        score += 1
    return score


def _major_match(major_name: str, eligible: Sequence[Any]) -> bool:
    text = str(major_name or "")
    for item in eligible:
        value = str(item or "").strip()
        if not value:
            continue
        if value == "all" or value in text or text in value:
            return True
    return False


def competition_candidates(
    profile: Mapping[str, Any], direction_id: str, limit: int = 6
) -> list[dict[str, Any]]:
    """Rank competitions for the student's direction/major/grade; never returns empty if data exists."""
    major = resolve_major(profile.get("major"))
    major_name = str((major or {}).get("major_name") or profile.get("major") or "")
    grade = grade_label(profile)
    competitions = list(load()["competitions"])
    if not competitions:
        return []
    recommended = set(str(item) for item in (major or {}).get("competition_ids") or [])

    def eligible(competition: Mapping[str, Any], *, strict_major: bool) -> bool:
        dirs = competition.get("direction_ids") or []
        if dirs and direction_id not in dirs:
            return False
        if strict_major:
            allowed = competition.get("eligible_majors") or ["all"]
            if "all" not in allowed and not _major_match(major_name, allowed):
                return False
        years = competition.get("eligible_years") or []
        if years and grade and grade not in years:
            return False
        return True

    selected = [item for item in competitions if eligible(item, strict_major=True)]
    if len(selected) < limit:
        selected = [item for item in competitions if eligible(item, strict_major=False) or item.get("competition_id") in recommended]
    deduped = _dedupe(selected, "competition_id")
    deduped.sort(
        key=lambda item: (
            item.get("competition_id") in recommended,
            _competition_score(item, profile, direction_id),
            _official_level_score((item.get("school_recognition") or {}).get("official_level")),
        ),
        reverse=True,
    )
    return deduped[:limit]


def employment_facts(limit: int = 4) -> list[dict[str, Any]]:
    """SUIBE employment facts, newest cohort first, one per metric."""
    facts = [item for item in load()["facts"] if str(item.get("school_id")) == "suibe"]
    if not facts:
        facts = list(load()["facts"])
    priority = {
        "employment_rate": 0,
        "further_study_rate": 1,
        "domestic_postgraduate_rate": 1,
        "overseas_rate": 2,
        "graduate_total": 9,
    }
    facts.sort(
        key=lambda item: (
            priority.get(str(item.get("metric_code") or ""), 5),
            -int(str(item.get("cohort") or "0").rstrip("届") or 0),
        )
    )
    seen: set[str] = set()
    result: list[dict[str, Any]] = []
    for item in facts:
        metric = str(item.get("metric_code") or item.get("metric_name") or "")
        if metric in seen:
            continue
        seen.add(metric)
        result.append(item)
        if len(result) >= limit:
            break
    return result


def resources(limit: int = 8) -> list[dict[str, Any]]:
    return list(load()["resources"])[:limit]


def _dedupe(items: Sequence[dict[str, Any]], key: str) -> list[dict[str, Any]]:
    seen: set[str] = set()
    result: list[dict[str, Any]] = []
    for item in items:
        value = str(item.get(key) or "").strip()
        if not value or value in seen:
            continue
        seen.add(value)
        result.append(item)
    return result


# ---------------------------------------------------------------------------
# 资料问答的参考检索（不依赖 Supabase）
# ---------------------------------------------------------------------------

INTENT_KEYWORDS = {
    "competition": ("竞赛", "比赛", "赛事", "加分", "素拓", "第二课堂", "参赛", "奖项"),
    "employment": ("就业", "去向", "就业率", "升学率", "毕业生", "薪资", "招聘", "行情"),
    "course": ("课程", "培养方案", "学分", "先修", "选课", "教材", "教学计划"),
    "resource": ("校内", "官网", "入口", "资源", "平台", "学院", "教务处", "就业中心", "图书馆"),
    "recommendation": ("推免", "保研", "推免资格", "综合成绩", "综测", "加分"),
}


def _intents(question: str) -> set[str]:
    text = str(question or "")
    return {intent for intent, words in INTENT_KEYWORDS.items() if any(word in text for word in words)}


LEVEL_LABELS = {"A": "国家级", "B": "市级", "C": "校级"}


def competition_points_hint(level: Any) -> str:
    """推免计分参考（来自用户提供的上外贸保研制度介绍；不是官方最终认定）。"""
    doc = load()["graduate"]
    if not doc:
        return ""
    mapping = (doc.get("level_mapping") or {}).get(str(level or "").strip().upper())
    if not mapping:
        return ""
    points = doc.get("competition_points") or {}
    if mapping == "national":
        individual = "20/15/10"
        team = "10/7/5"
    elif mapping == "municipal":
        individual = "10/6/3"
        team = "5/3/2"
    else:
        return "推免计分表未列校级竞赛，具体以学院当年细则为准。"
    return (
        f"按推免评分参考：{LEVEL_LABELS.get(str(level).upper(), mapping)}个人赛一/二/三等奖 {individual} 分，"
        f"团体赛 {team} 分；具体以学院当年细则为准。"
    )


def _reference_id(prefix: str, value: Any) -> str:
    raw = str(value or "").strip()
    return f"ref-{prefix}-{raw}" if raw else f"ref-{prefix}"


def search(question: str, *, limit: int = 4) -> list[dict[str, Any]]:
    """Keyword search over reference data; returns evidence-shaped dicts (citation_no unset)."""
    intents = _intents(question)
    if not intents:
        return []
    hits: list[dict[str, Any]] = []

    if "competition" in intents:
        for item in sorted(
            load()["competitions"],
            key=lambda value: _official_level_score((value.get("school_recognition") or {}).get("official_level")),
            reverse=True,
        )[: limit * 2]:
            recognition = item.get("school_recognition") or {}
            level = recognition.get("official_level")
            level_text = f"学校奖励清单 {level} 级；" if level else ""
            hits.append(
                {
                    "kind": "competition",
                    "title": str(item.get("name") or ""),
                    "text": (
                        f"{item.get('name', '')}（{item.get('organizer', '')}，{item.get('level_label', '')}）。"
                        f"{level_text}{item.get('timing', '')}。{item.get('note', '')}"
                    ),
                    "source_type": "official" if recognition.get("status") == "official_lead" else "research",
                    "verification_status": "official_lead" if recognition.get("status") == "official_lead" else "external_reference",
                    "source_id": _reference_id("competition", item.get("competition_id")),
                    "source_title": str(recognition.get("source_title") or item.get("source_title") or "竞赛目录"),
                    "locator": {"kind": "reference", "field": "competition"},
                    "canonical_url": _url(item.get("official_url") or recognition.get("source_url")),
                }
            )

    if "course" in intents:
        for entry in load()["curricula"][:6]:
            courses = [str(course.get("name") or "") for course in (entry.get("courses") or [])[:8]]
            if not courses:
                continue
            source = entry.get("source") or {}
            hits.append(
                {
                    "kind": "course",
                    "title": f"{entry.get('major_name', '')}培养方案课程",
                    "text": "、".join(courses) + "。以上课程来自培养方案文本，学分、先修与开课学期以教务处当年方案为准。",
                    "source_type": "catalog",
                    "verification_status": _verification(entry.get("verification_status") or "official_lead"),
                    "source_id": _reference_id("curriculum", source.get("source_id") or entry.get("major_key")),
                    "source_title": str(source.get("title") or "培养方案"),
                    "locator": {"kind": "reference", "field": "curriculum", "locator": source.get("locator")},
                    "canonical_url": _url(source.get("url")),
                }
            )

    if "employment" in intents:
        for fact in employment_facts(limit=limit):
            fact_status = _verification(fact.get("verification_status"))
            hits.append(
                {
                    "kind": "employment",
                    "title": str(fact.get("source_title") or "就业质量报告"),
                    "text": (
                        f"{fact.get('school_name', '')}{fact.get('cohort', '')}{fact.get('metric_name', '')}："
                        f"{fact.get('value', '')}{'%' if fact.get('unit') == 'percent' else ''}。"
                        f"{fact.get('quote', '')}"
                    ),
                    "source_type": "official" if fact_status == "official_lead" else "research",
                    "verification_status": fact_status,
                    "source_id": _reference_id("employment", fact.get("fact_id")),
                    "source_title": str(fact.get("source_title") or "就业质量报告"),
                    "locator": {"kind": "reference", "field": "employment", "locator": fact.get("locator")},
                    "canonical_url": _url(fact.get("source_url")),
                }
            )

    if "recommendation" in intents:
        doc = load()["graduate"]
        if doc:
            rank = "；".join(f"{row.get('band')} {row.get('points')} 分" for row in doc.get("academic_rank_points") or [])
            individual = "；".join(
                f"{row.get('grade')} 市级 {row.get('municipal')} / 国家级 {row.get('national')}"
                for row in (doc.get("competition_points") or {}).get("individual") or []
            )
            hits.append(
                {
                    "kind": "recommendation",
                    "title": str((doc.get("source") or {}).get("title") or "推免综合成绩构成"),
                    "text": (
                        "推免综合成绩由思想品德、学习成绩、科研创新能力、全面发展构成。"
                        f"专业排名分值：{rank}。竞赛个人赛：{individual}（国际级按国家级算；团体赛减半，具体见表）。"
                        "竞赛级别按学生处《学生竞赛奖励项目清单》认定，各学院细则不同，以当年正式文件为准。"
                    ),
                    "source_type": "research",
                    "verification_status": "pending_verification",
                    "source_id": _reference_id("recommendation", "graduate"),
                    "source_title": str((doc.get("source") or {}).get("title") or "推免综合成绩构成"),
                    "locator": {"kind": "reference", "field": "graduate_recommendation"},
                    "canonical_url": None,
                }
            )

    if "resource" in intents:
        for item in resources(limit=limit):
            hits.append(
                {
                    "kind": "resource",
                    "title": str(item.get("name") or ""),
                    "text": f"{item.get('name', '')}：{item.get('description', '')}（{item.get('url', '')}）",
                    "source_type": "other",
                    "verification_status": _verification(item.get("verification_status")),
                    "source_id": _reference_id("resource", item.get("resource_id")),
                    "source_title": str(item.get("source_title") or item.get("name") or ""),
                    "locator": {"kind": "reference", "field": "resource"},
                    "canonical_url": _url(item.get("url")),
                }
            )

    keywords = [token for token in str(question or "").replace("？", " ").replace("，", " ").split() if len(token) >= 2]

    def score(item: Mapping[str, Any]) -> int:
        text = f"{item.get('title', '')}{item.get('text', '')}"
        return sum(1 for token in keywords if token in text)

    hits.sort(key=lambda item: score(item), reverse=True)
    # 每个识别到的意图至少保留一条，避免“入口类问题只出竞赛”这种偏科。
    selected: list[dict[str, Any]] = []
    for intent in sorted(intents):
        kind = intent
        for item in hits:
            if item.get("kind") == kind and item not in selected:
                selected.append(item)
                break
    for item in hits:
        if len(selected) >= limit:
            break
        if item not in selected:
            selected.append(item)
    return selected[:limit]
