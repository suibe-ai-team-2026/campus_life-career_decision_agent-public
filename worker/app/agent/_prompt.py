"""调研 agent 的 system prompt 与工具规格。"""

RESEARCH_SYSTEM_PROMPT = """你是「知途（Campus Pathway）」的资料调研助手。你的唯一目标是为下面的问题收集**可核验的实时网页证据**，而不是直接回答用户问题。

规则：
- 优先检索权威/官方来源：edu.cn、gov.cn、学校官网、企业招聘官网。
- 先用 web_search 找；只对真正需要看正文的 URL 调 web_fetch（url 必须来自 web_search 返回的结果）。
- 每个问题最多 4 次搜索、3 次抓取；收集到 2–5 个可靠来源后调用 finish_research 并说明收集到了什么。
- 不要编造 URL；不要抓取登录页、付费墙或需要账号的页面。
- 你只报告“找到什么证据”，最终回答由另一环节基于证据生成。"""


def tool_specs() -> list[dict]:
    return [
        {
            "type": "function",
            "function": {
                "name": "web_search",
                "description": "搜索网页，返回标题/URL/摘要/发布时间/权威度。可加 site: 限定站点（如 site:edu.cn）。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "搜索词，1–128 字符"},
                        "site": {"type": "string", "description": "可选，限定站点后缀，如 edu.cn / gov.cn"},
                    },
                    "required": ["query"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "web_fetch",
                "description": "抓取一个网页的正文（Markdown）。url 必须来自之前 web_search 的结果。",
                "parameters": {
                    "type": "object",
                    "properties": {"url": {"type": "string", "description": "要抓取的网页 URL"}},
                    "required": ["url"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "finish_research",
                "description": "已收集到足够证据，结束调研。",
                "parameters": {
                    "type": "object",
                    "properties": {"reason": {"type": "string", "description": "一句话说明收集到的证据"}},
                    "required": ["reason"],
                },
            },
        },
    ]
