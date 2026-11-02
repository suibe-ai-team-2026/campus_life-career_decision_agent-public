# 参考数据层（agent 的本地知识底座）

2026-11-02 起，worker 内置 `worker/app/reference_data/`，plan 生成与资料问答都会读取：

| 文件 | 内容 | 规模 | 核验状态 |
|---|---|---|---|
| `schools.json` | 7 所学校（上经贸 + 6 所上海高校）与官网/就业报告入口 | 7 | 官方入口 |
| `employment.json` | 就业事实 + 覆盖进度：上经贸 2021/2022 届报告、7 校 2021–2025 pending 事实 | 54 条事实 / 35 格覆盖 | 53 pending、1 official_lead |
| `curriculum.json` | 上经贸 40 个专业培养方案课程（2024/2025 级），含学分/学期/方向/技能标签 | 2004 门 | official_lead（机器提取，未逐条人工复核） |
| `competitions.json` | 竞赛目录 + 上经贸官方《竞赛奖励项目清单》A/B/C 等级 | 225 项（A70/B98/C33/文艺24） | 清单内 official_lead |
| `major-map.json` | 专业别名 → 方向/竞赛映射 | 16+ 专业 | 团队整理 |
| `resources.json` | 校内入口（教务/就业/团委/图书馆/学院…）+ 外部平台（学职平台/我爱竞赛网…） | 47 条 | official_lead / external_reference |
| `graduate_recommendation.json` | 上外贸推免综合成绩构成：学习成绩/专业排名分值、竞赛个人&团体获奖计分、荣誉与社会服务规则 | 1 份规则 | 用户提供资料，pending（各学院细则不同） |

## 使用方式

- **plan**：`build_course_leads` 按专业取培养方案课程；`build_competition_leads` 按方向/专业/年级/经历筛选竞赛并带 A/B/C 等级；`build_campus_facts` 输出就业事实卡；`build_campus_resources` 输出校内/外部入口。
- **ask**：`reference.search()` 按问题意图检索竞赛/课程/就业/资源，作为证据拼在 RAG 结果之后；RAG 无结果时仍可基于参考数据回答，引用卡来源标记为「团队参考数据」。

## 边界（写材料时必须保留）

- 就业事实是 `pending`：口径、届别、分母、来源都在条目里；不得声称已核验，不得跨校/跨届相减或排名。
- 培养方案课程是机器提取；学分、先修、开课学期与选课资格以教务处当年方案为准。
- 竞赛清单的 A/B/C 是学校奖励等级；`graduate_recommendation.json` 给出推免计分参考（A→国家级、B→市级为推断），但**各学院细则不同、C 级未在计分表**，具体以当年学院正式文件为准。
- 任何「课程 → 就业」的因果表述都不成立（课程与就业不在同一时间轴）。
- 参考数据不替代官方文件；所有对外数字可回溯到条目的 `source_title` / `url` / `locator`。
