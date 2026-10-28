"""中文 PDF 导出：reportlab + UnicodeCIDFont('STSong-Light')。

产物是人工可读的方案 PDF，包含：画像摘要 / 暂定方向 / 时间线 / 规则版本 /
资料截止日 / 引用标题+定位 / 待核验项 / 免责声明。不包含未核验的就业率、薪资、
通过率等数字；规则事实与证据原文来自 Supabase 结果。
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
    "suggested": "建议（待确认）",
    "pending_verification": "待核验",
    "verified": "已核验",
    "user_modified": "用户已调整",
}
VERIFICATION_LABELS = {
    "known": "已知",
    "official_lead": "官方线索",
    "external_reference": "外部参考",
    "pending_verification": "待核验",
    "data_missing": "资料缺失",
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
    return json.dumps(dict(locator), ensure_ascii=False, sort_keys=True)[:160]


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
    """渲染 PDF 并返回 bytes；不写任何未核验数字。"""

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
            "本文件区分确定性规则、产品行动蓝图、官方线索与待核验资料；方向为暂定方向，不替你做决定。",
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
            pathway_lines.append("<b>为什么先走这条路线：</b>" + "；".join(_escape(item) for item in rationale[:3]))
        alternatives = list(pathway.get("alternatives") or [])
        if alternatives:
            pathway_lines.append("<b>备选路线：</b>" + _escape("、".join(str(item) for item in alternatives)))
        excluded = list(pathway.get("excluded") or [])
        if excluded:
            pathway_lines.append("<b>已按硬约束排除：</b>" + _escape("、".join(str(item) for item in excluded)))
        story.append(Paragraph("<br/>".join(pathway_lines), styles["body"]))
    else:
        story.append(Paragraph("本次方案没有返回主路线判断；请回自我探索补充路线偏好与硬约束。", styles["body"]))
    story.append(
        Paragraph(
            f"<b>当前比较方向：</b>{_escape(direction_title or direction_id)}（{_escape(direction_id)}）"
            f"<br/><font size=9 color='#555555'>方向是产品导航分类，不是学校官方就业分类；路线与方向均可结合后续体验调整。</font>",
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
            story.append(Paragraph("<b>风险与未知：</b>" + _escape("；".join(str(item) for item in risks[:4])), styles["body"]))

    # 4. 30 天与本学期
    roadmap = list(plan_result.get("roadmap") or [])
    story.append(Paragraph("四、30 天与本学期先做什么", styles["heading"]))
    prioritized = [stage for stage in roadmap if stage.get("stage") in {"未来 30 天"}]
    if len(roadmap) > 1:
        prioritized.append(roadmap[1])
    if not prioritized:
        story.append(Paragraph("本次没有返回路线行动蓝图；请先核对画像与资料版本后重新生成。", styles["body"]))
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
        story.append(Paragraph("暂无可执行的行动项；请先完成资料核对（见第十二节）。", styles["body"]))
    else:
        for window in ("current_term", "next_term", "later"):
            window_actions = [action for action in actions if action.get("window") == window]
            if not window_actions:
                continue
            story.append(Paragraph(WINDOW_LABELS.get(window, window), styles["body"]))
            for index, action in enumerate(window_actions, start=1):
                effort = action.get("effort") or {}
                hours = effort.get("hours")
                effort_text = f"预计投入：{hours} 小时" if hours else "预计投入：未提供（不虚构）"
                status = STATUS_LABELS.get(str(action.get("status")), str(action.get("status")))
                title = _escape(action.get("title"))
                story.append(
                    Paragraph(
                        f"{index}. {title}　<span color='#777777'>[{_escape(status)}｜{_escape(effort_text)}]</span>"
                        f"<br/><font size=8 color='#888888'>action_id: {_escape(action.get('action_id'))}｜规则：{_escape(action.get('rules_version'))}</font>",
                        styles["body"],
                    )
                )

    # 6. 课程与竞赛（只有规则引擎给出 verified 数据时才展示）
    courses = list(plan_result.get("courses") or [])
    competitions = list(plan_result.get("competitions") or [])
    story.append(Paragraph("六、课程与竞赛（仅已核验数据）", styles["heading"]))
    if courses:
        rows = [["课程", "学分", "开课学期", "核验"]]
        for course in courses:
            rows.append(
                [
                    _escape(course.get("title") or course.get("course_id")),
                    _escape(course.get("credits") if course.get("credits") is not None else "未提供"),
                    _escape("、".join(course.get("offered_terms") or []) or "未提供"),
                    _escape(course.get("verification_status")),
                ]
            )
        story.append(_grid_table(rows, styles))
    else:
        story.append(Paragraph("课程/培养方案数据尚未核验：<b>学分不展示具体数字</b>，请在教务系统或学院培养方案中核对。", styles["body"]))
    if competitions:
        for competition in competitions:
            story.append(
                Paragraph(
                    f"· {_escape(competition.get('title'))}（窗口：{_escape(competition.get('window') or '未提供')}，核验：{_escape(competition.get('verification_status'))}）",
                    styles["body"],
                )
            )
    else:
        story.append(Paragraph("竞赛目录与加分认定规则尚未核验，不展示竞赛加分结论。", styles["body"]))

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
                f"｜人工核验：{_escape(freshness.get('last_checked_at') or '尚未完成')}"
                if freshness
                else ""
            )
            story.append(
                Paragraph(
                    f"· <b>{_escape(item.get('title'))}</b> [{_escape(status)}]<br/>"
                    f"{_escape(item.get('description'))}<br/>"
                    f"<font size=8 color='#666666'>适用与边界：{_escape(item.get('why'))}｜核验方式："
                    f"{_escape(item.get('source_label'))}{tag_text}{source_text}{freshness_text}</font>",
                    styles["body"],
                )
            )

    # 8. 学分
    story.append(Paragraph("八、学分", styles["heading"]))
    credits = plan_result.get("credits")
    if credits is None:
        story.append(Paragraph("credits = null：资料缺失，<b>不表示 0 学分</b>；请以教务系统为准。", styles["body"]))
    else:
        story.append(Paragraph(f"规则引擎按已核验课程汇总的学分为 {_escape(credits)}；如需用于毕业审核，请以教务系统为准。", styles["body"]))

    # 9. 规则版本与资料截止日
    story.append(Paragraph("九、规则版本与资料截止日", styles["heading"]))
    story.append(
        Paragraph(
            f"规则版本：{_escape(plan_version.get('rules_version'))}<br/>"
            f"语料/embedding 版本：{_escape(plan_version.get('corpus_version') or '未记录')}<br/>"
            f"embedding profile：{_escape(plan_version.get('embedding_profile_id') or '未记录')}<br/>"
            f"资料截止日：{_escape(corpus_cutoff)}（以该日期已入库资料为准；此后发布的政策/培养方案可能未覆盖）",
            styles["body"],
        )
    )

    # 10. 引用标题 + 定位
    story.append(Paragraph("十、引用资料（标题与定位）", styles["heading"]))
    evidence = list(plan_result.get("evidence") or [])
    if not evidence:
        story.append(Paragraph("本方案没有可展示的引用资料（资料不足或未检索到可核验证据）。", styles["body"]))
    else:
        for item in evidence:
            story.append(
                Paragraph(
                    f"[{_escape(item.get('citation_no'))}] 《{_escape(item.get('title'))}》<br/>"
                    f"<font size=8 color='#555555'>定位：{_escape(_locator_text(item.get('locator')))}｜核验：{_escape(item.get('verification_status'))}"
                    f"｜来源ID：{_escape(item.get('source_id'))}</font>",
                    styles["body"],
                )
            )

    # 11. 解释
    explanation = plan_result.get("explanation")
    story.append(Paragraph("十一、方案说明", styles["heading"]))
    story.append(Paragraph(_escape(explanation).replace("\n", "<br/>") if explanation else "（无 AI 解释；方案事实来自规则引擎。）", styles["body"]))

    # 12. 待核验项
    story.append(Paragraph("十二、待核验项", styles["heading"]))
    gaps = list(plan_result.get("gaps") or [])
    pending_actions = [action for action in actions if action.get("status") == "pending_verification"]
    if not gaps and not pending_actions:
        story.append(Paragraph("当前没有标记为待核验的缺口。", styles["body"]))
    for gap in gaps:
        story.append(Paragraph(f"· [{_escape(gap.get('code'))}] {_escape(gap.get('message'))}", styles["body"]))
    for action in pending_actions:
        story.append(Paragraph(f"· 待核验行动：{_escape(action.get('title'))}", styles["body"]))

    # 13. 免责声明
    story.append(Paragraph("十三、免责声明", styles["heading"]))
    story.append(
        Paragraph(
            "本方案是生涯规划的辅助参考，不构成就业承诺、录取承诺、学分认定或官方政策解释。"
            "方向为暂定方向，最终决定权在用户。涉及培养方案、学分认定、竞赛加分、毕业要求的内容，"
            "一律以学校教务处、学院和官方文件为准。资料边界内的引用可在「方案详情」中回溯到来源定位。",
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
    table = Table(data, colWidths=[72 * mm, 20 * mm, 40 * mm, 28 * mm])
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
