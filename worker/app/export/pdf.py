"""中文 PDF 导出：reportlab + UnicodeCIDFont('STSong-Light')。

产物是人工可读的方案 PDF，包含：画像摘要 / 暂定方向 / 时间线 / 规则版本 /
资料截止日 / 引用标题+定位 / 下一步核对 / 适用范围。数字只来自规则引擎与证据，
不写入规则未给出的就业率、薪资、通过率等数字。
"""

from __future__ import annotations

import io
import json
from datetime import datetime, timezone
from typing import Any, Mapping, Sequence

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

FONT_NAME = "STSong-Light"
WINDOW_LABELS = {"current_term": "当前学期", "next_term": "下一学期", "later": "更晚（大三/大四或毕业后）"}
STATUS_LABELS = {
    "suggested": "建议执行",
    "pending_verification": "下一步核对",
    "verified": "官方来源",
    "user_modified": "用户已调整",
}
VERIFICATION_LABELS = {
    "known": "官方来源",
    "official_lead": "官方来源线索",
    "external_reference": "外部参考",
    "pending_verification": "下一步核对",
    "data_missing": "待向学校核对",
}

_font_registered = False


def ensure_font() -> None:
    global _font_registered
    if _font_registered:
        return
    pdfmetrics.registerFont(UnicodeCIDFont(FONT_NAME))
    _font_registered = True


def _escape(text: Any) -> str:
    value = "" if text is None else str(text)
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _styles() -> dict[str, ParagraphStyle]:
    ensure_font()
    base = getSampleStyleSheet()
    title = ParagraphStyle("CjkTitle", parent=base["Title"], fontName=FONT_NAME, fontSize=20, leading=28, spaceAfter=10, alignment=1)
    heading = ParagraphStyle("CjkHeading", parent=base["Heading2"], fontName=FONT_NAME, fontSize=13, leading=20, spaceBefore=12, spaceAfter=6, textColor=colors.HexColor("#1f3d5c"))
    body = ParagraphStyle("CjkBody", parent=base["BodyText"], fontName=FONT_NAME, fontSize=10.5, leading=16, spaceAfter=3)
    small = ParagraphStyle("CjkSmall", parent=body, fontSize=9, leading=13, textColor=colors.HexColor("#444444"))
    cell = ParagraphStyle("CjkCell", parent=body, fontSize=9, leading=13, spaceAfter=0)
    return {"title": title, "heading": heading, "body": body, "small": small, "cell": cell}


def _locator_text(locator: Mapping[str, Any] | None) -> str:
    if not locator:
        return "无可定位信息"
    kind = str(locator.get("kind") or "")
    if kind == "page_range":
        start = locator.get("page_start")
        end = locator.get("page_end")
        if start and end and start != end:
            return f"第 {start}–{end} 页"
        if start:
            return f"第 {start} 页"
    if kind == "page" and locator.get("page"):
        return f"第 {locator.get('page')} 页"
    if kind == "line_range":
        return f"第 {locator.get('line_start', '?')}–{locator.get('line_end', '?')} 行"
    if kind == "line":
        return f"第 {locator.get('line')} 行"
    if kind == "docx_block_range":
        return f"文档段落 {locator.get('block_start', '?')}–{locator.get('block_end', '?')}"
    if kind == "document":
        return "全文（解析器无页码）"
    if kind == "source_catalog":
        url = str(locator.get("canonical_url") or "")
        return f"来源目录页：{url}" if url else "来源目录页"
    if kind == "pdf_text_extraction":
        name = str(locator.get("file") or "").rsplit("/", 1)[-1]
        page = locator.get("page")
        where = f"第 {page} 页" if page else "PDF 正文"
        return f"{name} · {where}" if name else where
    if kind == "plan_suggestion":
        return f"团队建议 · {locator.get('section') or '能力准备路线'}"
    if locator.get("url"):
        return f"网页：{locator.get('url')}"
    return "来源条目"


def _clause_join(items: Sequence[Any], limit: int | None = None) -> str:
    """把句子收尾标点去掉后用「；」连接，避免出现"。；"。"""

    clauses: list[str] = []
    for item in (list(items)[:limit] if limit else list(items)):
        text = str(item).strip().rstrip("。；;，, ")
        if text:
            clauses.append(text)
    return "；".join(clauses)


def _datum(value: Any, fallback: str = "未提供") -> str:
    if value is None or value == "":
        return fallback
    return str(value)


def render_plan_pdf(
    *,
    plan_result: Mapping[str, Any],
    plan_version: Mapping[str, Any],
    profile: Mapping[str, Any] | None,
    direction_title: str | None = None,
) -> bytes:
    """渲染 PDF 并返回 bytes；数字只来自规则事实与证据，不写规则未给出的数字。"""

    styles = _styles()
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title="知途（Campus Pathway）生涯行动方案",
        author="知途 Campus Pathway",
    )
    story: list[Any] = []
    generated_at = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M")
    corpus_cutoff = str(plan_version.get("created_at") or "")[:10] or "未知"

    story.append(Paragraph("知途（Campus Pathway）生涯行动方案", styles["title"]))
    story.append(
        Paragraph(
            "本文件按确定性的规则事实、行动蓝图与官方来源线索组织；方向是暂定方向，最终决定权在你。",
            styles["small"],
        )
    )
    story.append(Spacer(1, 6 * mm))

    # 1. 画像摘要
    story.append(Paragraph("一、画像摘要", styles["heading"]))
    profile_rows = [
        ["学校", _datum((profile or {}).get("school"))],
        ["专业", _datum((profile or {}).get("major"))],
        ["入学年份", _datum((profile or {}).get("enrollment_year"))],
        ["当前学期", _datum((profile or {}).get("current_term"))],
        ["方案版本", f"v{plan_version.get('version', '?')}（画像版本 v{plan_version.get('profile_version', '?')}）"],
        ["生成时间", generated_at],
    ]
    story.append(_kv_table(profile_rows, styles))

    # 2. 路线与当前方向
    story.append(Paragraph("二、路线与当前方向", styles["heading"]))
    direction_id = str(plan_result.get("direction_id") or "")
    pathway = plan_result.get("pathway") if isinstance(plan_result.get("pathway"), Mapping) else {}
    if pathway:
        pathway_lines = [
            f"<b>当前比较路线：</b>{_escape(pathway.get('label') or pathway.get('primary'))}",
        ]
        rationale = list(pathway.get("rationale") or [])
        if rationale:
            pathway_lines.append("<b>为什么先走这条路线：</b>" + _escape(_clause_join(rationale, 3)))
        alternatives = list(pathway.get("alternatives") or [])
        if alternatives:
            pathway_lines.append("<b>备选路线：</b>" + _escape("、".join(str(item) for item in alternatives)))
        excluded = list(pathway.get("excluded") or [])
        if excluded:
            pathway_lines.append("<b>已按硬约束排除：</b>" + _escape("、".join(str(item) for item in excluded)))
        story.append(Paragraph("<br/>".join(pathway_lines), styles["body"]))
    else:
        story.append(Paragraph("方案按你的主路线与硬约束组织；回自我探索可以调整路线偏好。", styles["body"]))
    story.append(
        Paragraph(
            f"<b>当前比较方向：</b>{_escape(direction_title or direction_id)}（{_escape(direction_id)}）"
            f"<br/><font size=9 color='#555555'>方向是产品导航分类；同一岗位可以对应多个方向，路线与方向都能随经历调整。</font>",
            styles["body"],
        )
    )

    analysis = plan_result.get("analysis") if isinstance(plan_result.get("analysis"), Mapping) else {}
    if analysis:
        story.append(Paragraph("三、方向分析", styles["heading"]))
        if analysis.get("overview"):
            story.append(Paragraph(f"<b>方向概览：</b>{_escape(analysis.get('overview'))}", styles["body"]))
        if analysis.get("match"):
            story.append(Paragraph(f"<b>画像如何支撑：</b>{_escape(analysis.get('match'))}", styles["body"]))
        risks = list(analysis.get("risks") or [])
        if risks:
            story.append(Paragraph("<b>需要跟进的点：</b>" + _escape(_clause_join(risks, 4)), styles["body"]))

    # 4. 30 天与本学期
    roadmap = list(plan_result.get("roadmap") or [])
    story.append(Paragraph("四、30 天与本学期先做什么", styles["heading"]))
    prioritized = [stage for stage in roadmap if stage.get("stage") in {"未来 30 天"}]
    if len(roadmap) > 1:
        prioritized.append(roadmap[1])
    if not prioritized:
        story.append(Paragraph("行动蓝图按画像与资料版本生成；重新生成即可拉取最新版本。", styles["body"]))
    for stage in prioritized:
        story.append(
            Paragraph(
                f"<b>{_escape(stage.get('stage'))} · {_escape(stage.get('focus'))}</b>",
                styles["body"],
            )
        )
        for index, action in enumerate(list(stage.get("actions") or []), start=1):
            story.append(Paragraph(f"{index}. {_escape(action)}", styles["body"]))

    # 5. 时间线
    story.append(Paragraph("五、行动时间线", styles["heading"]))
    actions = list(plan_result.get("actions") or [])
    if not actions:
        story.append(Paragraph("行动项按规则事实生成；核对入口见第十二节。", styles["body"]))
    else:
        for window in ("current_term", "next_term", "later"):
            window_actions = [action for action in actions if action.get("window") == window]
            if not window_actions:
                continue
            story.append(Paragraph(WINDOW_LABELS.get(window, window), styles["body"]))
            for index, action in enumerate(window_actions, start=1):
                effort = action.get("effort") or {}
                hours = effort.get("hours")
                parts = [str(action.get("status") and STATUS_LABELS.get(str(action.get("status")), str(action.get("status"))) or "")]
                if hours:
                    parts.append(f"预计投入：{hours} 小时")
                meta = "｜".join(part for part in parts if part)
                title = _escape(action.get("title"))
                story.append(
                    Paragraph(
                        f"{index}. {title}" + (f"　<span color='#777777'>[{_escape(meta)}]</span>" if meta else ""),
                        styles["body"],
                    )
                )

    # 6. 课程与竞赛（只有规则引擎给出 verified 数据时才展示）
    courses = list(plan_result.get("courses") or [])
    competitions = list(plan_result.get("competitions") or [])
    story.append(Paragraph("六、课程与竞赛", styles["heading"]))
    if courses:
        rows = [["课程", "学分", "开课学期"]]
        for course in courses:
            rows.append(
                [
                    _escape(course.get("title") or course.get("course_id")),
                    _escape(course.get("credits") if course.get("credits") is not None else "以教务系统为准"),
                    _escape("、".join(course.get("offered_terms") or []) or "以教务系统为准"),
                ]
            )
        story.append(_grid_table(rows, styles))
    else:
        story.append(Paragraph("课程与学分按教务系统「培养方案」页确定；核对入口写在第十二节。", styles["body"]))
    if competitions:
        for competition in competitions:
            story.append(
                Paragraph(
                    f"· {_escape(competition.get('title'))}（时间窗：{_escape(competition.get('window') or '以当年通知为准')}）",
                    styles["body"],
                )
            )
    else:
        story.append(Paragraph("竞赛目录与加分认定以团委、教务处当年通知为准；核对入口写在第十二节。", styles["body"]))

    # 7. 上经贸课程、竞赛与校内资源线索
    lead_groups = (
        ("课程线索", list(plan_result.get("course_leads") or [])),
        ("竞赛线索", list(plan_result.get("competition_leads") or [])),
        ("校内与外部资源", list(plan_result.get("campus_resources") or [])),
    )
    story.append(Paragraph("七、上经贸课程、竞赛与校内资源线索", styles["heading"]))
    if not any(items for _, items in lead_groups):
        story.append(Paragraph("本次没有返回适用于当前学校与专业的资料线索。", styles["body"]))
    for group_title, items in lead_groups:
        if not items:
            continue
        story.append(Paragraph(f"<b>{group_title}</b>", styles["body"]))
        for item in items:
            status = VERIFICATION_LABELS.get(str(item.get("verification_status")), str(item.get("verification_status")))
            tags = list(item.get("skill_tags") or [])
            tag_text = f"｜能力标签：{_escape('、'.join(str(tag) for tag in tags))}" if tags else ""
            source_url = item.get("source_url")
            source_text = f"｜入口：{_escape(source_url)}" if source_url else ""
            freshness = item.get("freshness") if isinstance(item.get("freshness"), Mapping) else {}
            freshness_text = (
                f"｜更新频率：{_escape(freshness.get('update_frequency'))}"
                f"｜最近核对：{_escape(freshness.get('last_checked_at') or '按官网更新')}"
                if freshness
                else ""
            )
            story.append(
                Paragraph(
                    f"· <b>{_escape(item.get('title'))}</b> [{_escape(status)}]<br/>"
                    f"{_escape(item.get('description'))}<br/>"
                    f"<font size=8 color='#666666'>怎么用：{_escape(item.get('why'))}｜来源："
                    f"{_escape(item.get('source_label'))}{tag_text}{source_text}{freshness_text}</font>",
                    styles["body"],
                )
            )

    # 8. 学分
    story.append(Paragraph("八、学分", styles["heading"]))
    credits = plan_result.get("credits")
    if credits is None:
        story.append(Paragraph("学分合计见教务系统「培养方案」页，核对入口写在第十二节。", styles["body"]))
    else:
        story.append(Paragraph(f"规则引擎按官方课程数据汇总的学分为 {_escape(credits)}；毕业审核以教务系统记录为准。", styles["body"]))

    # 9. 规则版本与资料截止日
    story.append(Paragraph("九、规则版本与资料截止日", styles["heading"]))
    story.append(
        Paragraph(
            f"规则版本：{_escape(plan_version.get('rules_version'))}<br/>"
            f"语料/embedding 版本：{_escape(plan_version.get('corpus_version') or '未记录')}<br/>"
            f"embedding profile：{_escape(plan_version.get('embedding_profile_id') or '未记录')}<br/>"
            f"资料截止日：{_escape(corpus_cutoff)}；此后的新文件以官网最新发布版本为准",
            styles["body"],
        )
    )

    # 10. 引用标题 + 定位
    story.append(Paragraph("十、引用资料（标题与定位）", styles["heading"]))
    evidence = list(plan_result.get("evidence") or [])
    if not evidence:
        story.append(Paragraph("本次检索没有命中可引用的来源；检索范围与规则版本见第九节。", styles["body"]))
    else:
        for item in evidence:
            story.append(
                Paragraph(
                    f"[{_escape(item.get('citation_no'))}] 《{_escape(item.get('title'))}》<br/>"
                    f"<font size=8 color='#555555'>定位：{_escape(_locator_text(item.get('locator')))}</font>",
                    styles["body"],
                )
            )

    # 11. 解释
    explanation = plan_result.get("explanation")
    story.append(Paragraph("十一、方案说明", styles["heading"]))
    story.append(Paragraph(_escape(explanation).replace("\n", "<br/>") if explanation else "（方案说明按规则事实生成。）", styles["body"]))

    # 12. 下一步核对
    story.append(Paragraph("十二、下一步核对", styles["heading"]))
    gaps = list(plan_result.get("gaps") or [])
    pending_actions = [action for action in actions if action.get("status") == "pending_verification"]
    if not gaps and not pending_actions:
        story.append(Paragraph("当前没有需要额外核对的项目。", styles["body"]))
    for gap in gaps:
        story.append(Paragraph(f"· {_escape(gap.get('message'))}", styles["body"]))
    for action in pending_actions:
        story.append(Paragraph(f"· 下一步：{_escape(action.get('title'))}", styles["body"]))

    # 13. 适用范围
    story.append(Paragraph("十三、适用范围", styles["heading"]))
    story.append(
        Paragraph(
            "这份方案按规则事实与已归档的官方资料生成，方向是暂定的比较对象，最终决定权在你。"
            "培养方案、学分认定、竞赛加分与毕业要求以学校教务处、学院当年发布的文件为准；"
            "文中引用编号可在「方案详情」逐条回溯到来源定位。",
            styles["small"],
        )
    )
    doc.build(story)
    return buffer.getvalue()


def _kv_table(rows: Sequence[Sequence[Any]], styles: Mapping[str, ParagraphStyle]) -> Table:
    data = [[Paragraph(_escape(key), styles["cell"]), Paragraph(_escape(value), styles["cell"])] for key, value in rows]
    table = Table(data, colWidths=[30 * mm, 130 * mm])
    table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#c9d3dd")),
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#eef3f8")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    return table


def _grid_table(rows: Sequence[Sequence[Any]], styles: Mapping[str, ParagraphStyle]) -> Table:
    data = [[Paragraph(_escape(cell), styles["cell"]) for cell in row] for row in rows]
    table = Table(data, colWidths=[92 * mm, 24 * mm, 44 * mm])
    table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#c9d3dd")),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eef3f8")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    return table
