"""Deterministic career-planning blueprint.

The blueprint is product guidance, not external school/industry evidence. It
turns a selected route, direction, grade and profile signals into concrete next
actions while keeping course/competition names visibly marked as leads until
their official catalogs are verified.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from .models import PlanLead, PlanPathway, PlanRoadmapStage, SourceFreshness

PATHWAY_LABELS = {
    "undergraduate_employment": "本科就业",
    "domestic_postgraduate": "国内升学",
    "overseas_study": "境外升学",
    "public_exam": "公考 / 编制",
    "undetermined": "仍不确定",
}

ABILITY_LABELS = {
    "research": "信息搜集与研究",
    "data": "数据理解与分析",
    "writing": "写作表达",
    "communication": "沟通协作",
    "execution": "组织执行",
    "digital": "数字工具应用",
}

INTEREST_LABELS = {
    "r": "实践",
    "i": "研究",
    "a": "创意",
    "s": "社会",
    "e": "企业",
    "c": "常规",
}

SCHOOL_HOME = "https://www.suibe.edu.cn/"
EXTERNAL_COMPETITION_HUB = "https://www.52jingsai.com/"
SUPPORTED_ENROLLMENT_YEAR = 2026

COURSE_LEADS: dict[str, tuple[tuple[str, str, tuple[str, ...]], ...]] = {
    "trade_supply_chain": (
        ("国际贸易实务", "把合同、单证、结算与履约流程串成可核验的业务链。", ("国际贸易", "流程")),
        ("商务沟通与函电（英）", "把英语优势转成可用于客户沟通和书面业务表达的证据。", ("英语", "沟通", "写作")),
        ("国际贸易模拟", "在模拟业务中检验报价、履约与风险处理能力。", ("国际贸易", "执行")),
        ("电子商务数据分析与数据化运营", "补足数据理解与工具应用，形成业务分析证据。", ("数据", "数字工具")),
        ("统计学", "为市场判断、调查与数据解释打基础。", ("数据", "研究")),
    ),
    "cross_border_business": (
        ("跨境电子商务", "理解平台运营、选品、内容与履约的核心流程。", ("跨境电商", "运营")),
        ("数字贸易概论", "建立数字贸易规则、平台与商业模式的整体框架。", ("数字贸易", "研究")),
        ("商务沟通与函电（英）", "训练英文商品说明、客户沟通和业务写作。", ("英语", "写作")),
        ("电子商务数据分析与数据化运营", "把运营问题转成指标、数据与复盘。", ("数据", "运营")),
        ("Python", "为数据整理、自动化与后续商业分析建立基础。", ("数据", "数字工具")),
    ),
    "finance_accounting": (
        ("会计学", "建立报表、核算与财务语言的基础。", ("财务", "规则")),
        ("财务管理", "理解资金、成本、投资与经营决策。", ("财务", "分析")),
        ("统计学", "为风险、抽样与财务数据解释打基础。", ("数据", "研究")),
        ("Python", "补足重复数据处理与自动化能力。", ("数据", "数字工具")),
    ),
    "data_business": (
        ("统计学", "建立描述、推断与实验分析的基础。", ("数据", "研究")),
        ("Python", "训练数据清洗、分析和复现能力。", ("数据", "数字工具")),
        ("数据库", "理解数据结构、查询与业务取数。", ("数据", "SQL")),
        ("电子商务数据分析与数据化运营", "把指标分析放回真实业务场景。", ("数据", "运营")),
    ),
    "public_service": (
        ("公共政策", "理解政策形成、执行与评估的逻辑。", ("规则", "研究")),
        ("公共管理", "了解组织运行、公共服务与治理场景。", ("组织", "执行")),
        ("统计学", "为政策数据、调查与评估建立基础。", ("数据", "研究")),
    ),
    "further_study": (
        ("学术写作", "训练问题提出、文献梳理与论证表达。", ("写作", "研究")),
        ("研究方法", "建立研究设计、证据判断与方法意识。", ("研究", "方法")),
        ("统计学", "为实证研究与数据分析打基础。", ("数据", "研究")),
    ),
}

COMPETITION_LEADS: dict[str, tuple[tuple[str, str, tuple[str, ...]], ...]] = {
    "trade_supply_chain": (
        ("全国高校商业精英挑战赛国际贸易竞赛", "适合检验国际贸易实务、团队协作和展示能力。", ("国际贸易", "沟通", "执行")),
        ("POCIB 全国外贸从业能力大赛", "以外贸业务链条训练报价、函电、单证和履约。", ("国际贸易", "英语", "执行")),
        ("全国大学生市场调查与分析大赛", "用调研与数据解释补足研究能力。", ("研究", "数据", "写作")),
        ("全国大学生电子商务“创新、创意及创业”挑战赛", "适合把跨境或数字化想法做成团队项目。", ("创意", "运营", "协作")),
    ),
    "cross_border_business": (
        ("全国大学生电子商务“创新、创意及创业”挑战赛", "直接覆盖平台、内容、商业模式和团队落地。", ("创意", "运营", "协作")),
        ("全国大学生市场调查与分析大赛", "训练选品、用户研究与数据解释。", ("研究", "数据", "写作")),
        ("全国高校商业精英挑战赛国际贸易竞赛", "补足跨境业务中的贸易实务与履约知识。", ("国际贸易", "执行")),
        ("“挑战杯”全国大学生课外学术科技作品竞赛", "适合把数字贸易或消费研究做成完整作品。", ("研究", "写作", "创新")),
    ),
    "finance_accounting": (
        ("全国大学生市场调查与分析大赛", "训练金融消费者、市场与风险问题的研究。", ("研究", "数据", "写作")),
        ("全国大学生电子商务“创新、创意及创业”挑战赛", "适合数字化财务或商业方案项目。", ("创意", "分析", "协作")),
        ("“挑战杯”全国大学生课外学术科技作品竞赛", "适合围绕企业、市场或金融问题形成研究作品。", ("研究", "写作")),
    ),
    "data_business": (
        ("全国大学生市场调查与分析大赛", "覆盖问卷、统计、分析与报告表达。", ("研究", "数据", "写作")),
        ("全国大学生电子商务“创新、创意及创业”挑战赛", "把数据能力放进产品、运营或商业方案。", ("数据", "运营", "协作")),
        ("“挑战杯”全国大学生课外学术科技作品竞赛", "适合形成信息密集型研究或技术应用作品。", ("研究", "写作", "数字工具")),
    ),
    "public_service": (
        ("“挑战杯”全国大学生课外学术科技作品竞赛", "适合公共议题、社会治理与调查研究。", ("研究", "写作", "执行")),
        ("全国大学生市场调查与分析大赛", "训练社会调查、数据解释与政策表达。", ("研究", "数据", "写作")),
        ("全国大学生电子商务“创新、创意及创业”挑战赛", "适合公共服务数字化方案。", ("创意", "协作", "执行")),
    ),
    "further_study": (
        ("“挑战杯”全国大学生课外学术科技作品竞赛", "用于检验研究选题、文献与论证能力。", ("研究", "写作", "创新")),
        ("全国大学生市场调查与分析大赛", "训练从问题到数据再到结论的完整研究流程。", ("研究", "数据", "写作")),
    ),
}

RESOURCE_ROWS = (
    ("教务处", "核对培养方案、课程属性、学分、先修、开课学期与选课通知。", "所有年级；每学期选课前复核"),
    ("国际经贸学院", "查看学院通知、教师与专业活动，确认课程和方向资源。", "课程与专业方向确认"),
    ("学生就业指导中心", "查看招聘、实习、生涯咨询与学校就业质量报告。", "大一下起持续使用"),
    ("团委 / 第二课堂", "查看竞赛、社会实践、志愿服务和素质拓展认定入口。", "全年滚动"),
    ("国际交流处 / 国际合作项目", "需要境外升学或交换时核对项目、语言和费用要求。", "有境外路线时优先"),
    ("图书馆", "使用数据库、行业报告、统计资料和文献获取能力训练。", "研究与课程作业"),
)

EXTERNAL_RESOURCE_ROWS = (
    (
        "我爱竞赛网",
        "集中浏览竞赛通知、报名时间和参赛经验；最终资格与校内认定仍以主办方及学校通知为准。",
        "需要扩展竞赛信息源时",
        EXTERNAL_COMPETITION_HUB,
    ),
    (
        "上经贸第二学堂",
        "用于关注学校第二课堂、素养积分和活动通知；首版未抓取完整栏目，请在校内入口或公众号中搜索准确名称。",
        "全年关注校内实践与素养积分时",
        None,
    ),
)


def _scores(profile: Mapping[str, Any]) -> Mapping[str, Any]:
    value = profile.get("scores")
    return value if isinstance(value, Mapping) else {}


def _preferences(profile: Mapping[str, Any]) -> Mapping[str, Any]:
    value = profile.get("preferences")
    return value if isinstance(value, Mapping) else {}


def _pathway_preferences(profile: Mapping[str, Any]) -> Mapping[str, Any]:
    value = _preferences(profile).get("pathway")
    return value if isinstance(value, Mapping) else {}


def _ranked_abilities(profile: Mapping[str, Any]) -> list[tuple[str, float]]:
    scores = _scores(profile)
    result = []
    for key in ABILITY_LABELS:
        value = scores.get(f"ability_{key}")
        try:
            result.append((key, float(value)))
        except (TypeError, ValueError):
            continue
    return sorted(result, key=lambda item: (-item[1], item[0]))


def _ranked_interests(profile: Mapping[str, Any]) -> list[tuple[str, float]]:
    scores = _scores(profile)
    result = []
    for key in INTEREST_LABELS:
        value = scores.get(f"interest_{key}")
        try:
            result.append((key, float(value)))
        except (TypeError, ValueError):
            continue
    return sorted(result, key=lambda item: (-item[1], item[0]))


def direction_exclusion_reason(
    direction_id: str, profile: Mapping[str, Any]
) -> str | None:
    preferences = _pathway_preferences(profile)
    excluded_directions = preferences.get("excluded_directions")
    excluded_sectors = preferences.get("excluded_sectors")
    directions = {str(item) for item in excluded_directions} if isinstance(excluded_directions, list) else set()
    sectors = {str(item) for item in excluded_sectors} if isinstance(excluded_sectors, list) else set()
    if direction_id in directions:
        return "该方向在你的明确排除条件中"
    if direction_id == "public_service" and "public_sector" in sectors:
        return "你已明确排除体制内 / 政审类岗位"
    if direction_id == "finance_accounting" and "finance" in sectors:
        return "你已明确排除金融财会方向"
    if direction_id == "data_business" and "data" in sectors:
        return "你已明确排除纯数据分析方向"
    if direction_id == "further_study" and "further_study" in sectors:
        return "你已明确排除继续升学方向"
    if direction_id in {"trade_supply_chain", "cross_border_business"} and "international_business" in sectors:
        return "你已明确排除外贸 / 跨境业务方向"
    return None


def _pathway_excluded(primary: str, preferences: Mapping[str, Any]) -> bool:
    sectors = preferences.get("excluded_sectors")
    excluded_sectors = {str(item) for item in sectors} if isinstance(sectors, list) else set()
    excluded_directions = preferences.get("excluded_directions")
    excluded_direction_ids = (
        {str(item) for item in excluded_directions}
        if isinstance(excluded_directions, list)
        else set()
    )
    if primary == "public_exam":
        return "public_sector" in excluded_sectors or "public_service" in excluded_direction_ids
    if primary in {"domestic_postgraduate", "overseas_study"}:
        return "further_study" in excluded_sectors or "further_study" in excluded_direction_ids
    return False


def build_pathway(profile: Mapping[str, Any]) -> PlanPathway:
    preferences = _pathway_preferences(profile)
    primary = str(preferences.get("primary") or "undetermined")
    if primary not in PATHWAY_LABELS:
        primary = "undetermined"
    abilities = _ranked_abilities(profile)
    strongest = abilities[0] if abilities else None
    interests = _ranked_interests(profile)
    strongest_interest = interests[0] if interests else None
    practice = _preferences(profile).get("pathway", {}).get("practice_orientation") if isinstance(_preferences(profile).get("pathway"), Mapping) else None

    rationale = []
    if strongest:
        rationale.append(
            f"当前相对较强的能力自评是{ABILITY_LABELS[strongest[0]]}；先把它转成课程、项目或实践证据，再决定是否长期投入。"
        )
    if strongest_interest:
        rationale.append(
            f"当前较愿意投入的{INTEREST_LABELS[strongest_interest[0]]}类活动只表示兴趣偏好，需要结合真实任务体验复核。"
        )
    if primary == "undetermined":
        rationale.append("你暂未确定主路线，所以方案先安排低成本核验，而不是用一个标签替你做决定。")
    else:
        rationale.append(f"你填写的主路线是「{PATHWAY_LABELS[primary]}」，推荐与行动将以此作为准备起点。")
    if practice == "practice":
        rationale.append("你明确偏实践，规划优先安排真实任务、作品和实习反馈。")
    if practice == "research":
        rationale.append("你明确偏研究，规划优先安排阅读、方法训练与研究产出。")

    if _pathway_excluded(primary, preferences):
        fallback_primary = (
            "undergraduate_employment"
            if practice == "practice"
            else "domestic_postgraduate"
            if practice == "research" and not _pathway_excluded("domestic_postgraduate", preferences)
            else "undetermined"
        )
        rationale.append(
            f"你填写的主路线「{PATHWAY_LABELS[primary]}」同时命中硬排除条件，"
            "因此不会作为方案起点；系统改为先比较未被排除的路线。"
        )
        primary = fallback_primary

    alternatives = preferences.get("alternatives")
    alternative_labels = [
        PATHWAY_LABELS[str(item)]
        for item in alternatives
        if isinstance(item, str)
        and item in PATHWAY_LABELS
        and item != primary
        and not _pathway_excluded(item, preferences)
    ] if isinstance(alternatives, list) else []
    excluded = []
    sectors = preferences.get("excluded_sectors")
    if isinstance(sectors, list):
        excluded_labels = {
            "public_sector": "体制内 / 政审类岗位",
            "finance": "金融财会",
            "data": "纯数据分析",
            "further_study": "继续升学",
            "international_business": "外贸 / 跨境业务",
        }
        excluded.extend(excluded_labels[str(item)] for item in sectors if str(item) in excluded_labels)
    if _pathway_excluded("public_exam", preferences) and "体制内 / 政审类岗位" not in excluded:
        excluded.append("体制内 / 政审类岗位")
    if _pathway_excluded("domestic_postgraduate", preferences) and "继续升学" not in excluded:
        excluded.append("继续升学")
    return PlanPathway(
        primary=primary,
        label=PATHWAY_LABELS[primary],
        rationale=rationale,
        alternatives=alternative_labels,
        excluded=excluded,
    )


def build_course_leads(direction_id: str, profile: Mapping[str, Any]) -> list[PlanLead]:
    school = str(profile.get("school") or "")
    major = str(profile.get("major") or "")
    try:
        enrollment_year = int(profile.get("enrollment_year"))
    except (TypeError, ValueError):
        enrollment_year = 0
    if (
        "上海对外经贸大学" not in school
        or "国际经济与贸易" not in major
        or enrollment_year != SUPPORTED_ENROLLMENT_YEAR
    ):
        return []
    leads = []
    for index, (title, description, tags) in enumerate(COURSE_LEADS.get(direction_id, ())):
        leads.append(
            PlanLead(
                lead_id=f"course-lead-{direction_id}-{index + 1}",
                title=title,
                description=description,
                why="课程名称来自产品整理的国贸专业线索；学分、先修、开课学期与选课资格尚未完成官方结构化核验。",
                skill_tags=list(tags),
                verification_status="official_lead",
                source_label="上海对外经贸大学官网入口；培养方案待教务部门核验",
                source_url=SCHOOL_HOME,
                freshness=SourceFreshness(
                    verification_status="official_lead",
                    update_frequency="每学期选课前复核",
                    source_url=SCHOOL_HOME,
                ),
            )
        )
    return leads


def build_competition_leads(direction_id: str, profile: Mapping[str, Any]) -> list[PlanLead]:
    preferences = _pathway_preferences(profile)
    if preferences.get("accepts_competition") is False:
        return []
    leads = []
    for index, (title, description, tags) in enumerate(COMPETITION_LEADS.get(direction_id, ())):
        leads.append(
            PlanLead(
                lead_id=f"competition-lead-{direction_id}-{index + 1}",
                title=title,
                description=description,
                why="赛事名称用于建立了解清单；报名资格、年度时间窗、组队要求和校内认定必须以当年官方通知复核。",
                skill_tags=list(tags),
                verification_status="external_reference",
                source_label="我爱竞赛网与学校竞赛通知；官方页面待逐年核验",
                source_url=EXTERNAL_COMPETITION_HUB,
                freshness=SourceFreshness(
                    verification_status="external_reference",
                    update_frequency="赛事公告发布后复核",
                    source_url=EXTERNAL_COMPETITION_HUB,
                ),
            )
        )
    return leads


def build_campus_resources(profile: Mapping[str, Any]) -> list[PlanLead]:
    school = str(profile.get("school") or "")
    if "上海对外经贸大学" not in school:
        return []
    official_resources = [
        PlanLead(
            lead_id=f"campus-resource-{index + 1}",
            title=title,
            description=description,
            why=stage,
            skill_tags=[],
            verification_status="official_lead",
            source_label="上海对外经贸大学官网入口；具体栏目与开放时间需复核",
            source_url=SCHOOL_HOME,
            freshness=SourceFreshness(
                verification_status="official_lead",
                update_frequency="使用前复核栏目入口",
                source_url=SCHOOL_HOME,
            ),
        )
        for index, (title, description, stage) in enumerate(RESOURCE_ROWS)
    ]
    external_resources = [
        PlanLead(
            lead_id=f"external-resource-{index + 1}",
            title=title,
            description=description,
            why=stage,
            skill_tags=[],
            verification_status="external_reference",
            source_label=(
                "外部平台；具体栏目、活动和认定口径需在学校或平台官方入口复核"
                if source_url
                else "外部平台；暂无可验证的直达链接，请在校内入口或公众号中搜索准确名称"
            ),
            source_url=source_url,
            freshness=SourceFreshness(
                verification_status="external_reference",
                update_frequency="使用前查看平台最新公告",
                source_url=source_url,
            ),
        )
        for index, (title, description, stage, source_url) in enumerate(EXTERNAL_RESOURCE_ROWS)
    ]
    return [*official_resources, *external_resources]


def _grade_stage(profile: Mapping[str, Any]) -> tuple[int, str]:
    try:
        enrollment_year = int(profile.get("enrollment_year"))
    except (TypeError, ValueError):
        enrollment_year = 2026
    current_term = str(profile.get("current_term") or "")
    try:
        calendar_year = int(current_term[:4])
    except ValueError:
        calendar_year = enrollment_year
    academic_start = calendar_year if "秋" in current_term else calendar_year - 1
    grade_index = max(0, min(4, academic_start - enrollment_year))
    term = "下" if "春" in current_term else "上"
    return grade_index, f"{['大一', '大二', '大三', '大四', '毕业后'][grade_index]}{term}"


def build_roadmap(
    direction_id: str,
    profile: Mapping[str, Any],
) -> list[PlanRoadmapStage]:
    grade_index, stage_label = _grade_stage(profile)
    abilities = _ranked_abilities(profile)
    weakest = abilities[-1][0] if abilities else "data"
    strongest = abilities[0][0] if abilities else "execution"
    pathway = build_pathway(profile)
    preferences = _pathway_preferences(profile)
    first_month_actions = [
        "从教务处或学院确认本专业培养方案，记录 3 门与方向相关课程的真实学分、开课学期和先修要求。",
        f"围绕当前方向找 5 条真实岗位或实习描述，提取重复要求；用{ABILITY_LABELS[strongest]}优势完成一份可展示的样例或复盘。",
        f"为{ABILITY_LABELS[weakest]}安排每周固定练习，并在 30 天后用作品、测试或课程作业复核。",
    ]
    target_cities = preferences.get("target_cities")
    if isinstance(target_cities, list) and target_cities:
        cities = "、".join(str(item) for item in target_cities[:3] if str(item).strip())
        if cities:
            first_month_actions.append(
                f"围绕目标城市「{cities}」筛选岗位与实习，记录发布机构、岗位要求、更新时间和信息来源。"
            )
    weekly_hours = _preferences(profile).get("weekly_hours")
    if isinstance(weekly_hours, (int, float)) and weekly_hours > 0:
        first_month_actions.append(
            f"按每周约 {int(weekly_hours)} 小时的现实投入排期，并为课程、实践和复盘各留出固定时段。"
        )

    stages = [
        PlanRoadmapStage(
            stage="未来 30 天",
            focus="核对信息 + 做出第一份证据",
            actions=first_month_actions,
        ),
        PlanRoadmapStage(
            stage=stage_label,
            focus="完成本学期可交付成果",
            actions=[
                "从课程线索中只选择教务系统确认可选的 1–2 门课，记录它们对应的岗位能力。",
                "从竞赛线索中选择 1 项核对当年资格与时间；不符合年级或投入要求就不强行参加。",
                "关注就业中心、学院与第二课堂通知，建立自己的信息来源。",
            ],
        ),
    ]
    if grade_index <= 1:
        stages.append(
            PlanRoadmapStage(
                stage="大二",
                focus="形成一项方向相关的连续实践",
                actions=[
                    "完成一门方向核心课程的应用作业，并沉淀为作品或报告。",
                    "尝试一次竞赛、社团项目或短期实践，记录自己是否愿意长期做这类工作。",
                    "开始使用学校就业与实习资源，核对目标岗位的学历、英语和工具要求。",
                ],
            )
        )
    if grade_index <= 2:
        stages.append(
            PlanRoadmapStage(
                stage="大三",
                focus="用真实实习或研究经历决定主路线",
                actions=[
                    "争取一段与方向相关的连续实习；没有机会时，用课程项目或教师研究项目替代一部分验证。",
                    "复盘本科就业、升学与公考的资格、成本和真实体验，决定是否调整主路线。",
                    "建立岗位或项目作品集，保留过程、数据来源和个人贡献。",
                ],
            )
        )
    stages.append(
        PlanRoadmapStage(
            stage="大四 / 路线兑现",
            focus=f"围绕「{pathway.label}」完成申请或求职证据链",
            actions=[
                "按目标岗位、院校或考试公告逐项核对硬性资格，不用上一届经验替代当年规则。",
                "完成简历、作品集、推荐材料或备考计划的最终版本，并安排至少一次模拟反馈。",
                "复核课程学分、竞赛认定与毕业要求；所有官方数字以教务系统或当年公告为准。",
            ],
        )
    )
    if preferences.get("accepts_certificate") is not False and len(stages) >= 2:
        current = stages[1]
        stages[1] = current.model_copy(
            update={
                "actions": [
                    *current.actions,
                    "若考虑证书，只选择与方向直接相关的一项，先核对主办方、报名资格、费用、考试窗口和可展示能力，再决定投入。",
                ]
            }
        )
    if preferences.get("accepts_long_internship") is False and len(stages) >= 2:
        current = stages[1]
        stages[1] = current.model_copy(
            update={
                "actions": [
                    *current.actions,
                    "你当前不接受长期实习，先用课程项目、短期实践或校内项目验证方向，不把长期实习列为硬要求。",
                ]
            }
        )
    return stages


@dataclass(frozen=True)
class PlanningBlueprint:
    pathway: PlanPathway
    course_leads: tuple[PlanLead, ...]
    competition_leads: tuple[PlanLead, ...]
    campus_resources: tuple[PlanLead, ...]
    roadmap: tuple[PlanRoadmapStage, ...]


def build_planning_blueprint(
    profile: Mapping[str, Any], direction_id: str
) -> PlanningBlueprint:
    return PlanningBlueprint(
        pathway=build_pathway(profile),
        course_leads=tuple(build_course_leads(direction_id, profile)),
        competition_leads=tuple(build_competition_leads(direction_id, profile)),
        campus_resources=tuple(build_campus_resources(profile)),
        roadmap=tuple(build_roadmap(direction_id, profile)),
    )
