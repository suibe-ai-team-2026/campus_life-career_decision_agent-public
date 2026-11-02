# 竞赛与资源参考数据 · 来源与核验说明

| 项 | 内容 |
|---|---|
| 生成日期 | 2026-11-02 |
| 最近核对 | 2026-11-02（HTTP 状态与页面正文，见“核验方法”） |
| 产出文件 | `competitions.json`、`major-map.json`、`resources.json`、本说明 |
| 用途 | agent 依据用户的学校/专业/年级/经历推荐“值得参加、能加分”的竞赛；资料问答的来源参考 |
| 状态 | **外部参考数据**。校内认定一律 `pending`，未转载任何未获授权的加分/素拓分数 |

## 1. 这次数据从哪来

### 1.1 团队内部设计稿（只取设计口径，不取数字）

- `../smart-campus-career/docs/生涯向导-网页策划方案.md`：竞赛清单 = 目录内 + 方向相关 + 时间匹配；校赛→省赛→国赛路径；截止日与加分档位作为待接字段。
- `../smart-campus-career/docs/A2-生涯方案-核心版.md`：竞赛目录属于“规则引擎 + 官方数据”的一部分，AI 只做解释。
- `../smart-campus-career/docs/product-v2.md`：竞赛推荐 = 以赛代学路径 + 截止日 + 加分档位；素拓学分测算需要校内认定文件。
- `../smart-campus-career/docs/outcome-research.md`：竞赛的研究单位是“作品和个人贡献”，不能把获奖当作录用因果；本数据只做推荐线索。
- `../ai-agent-competition-2026/`：竞赛目录与素拓认定文件属于待收集数据（Issue #18），**目前没有官方目录**。本文件因此只写公开赛事信息，校内认定统一标 `pending`。

### 1.2 公开官网与转引通知（每条赛事的字段来源）

逐条核对了赛事官网或可公开访问的官方/高校通知页，主要来源（2026-11-02 实际抓取）：

| 赛事 | 使用的页面 |
|---|---|
| 市场调查与分析大赛 | `http://www.china-cssc.org/show-304-2179-1.html`（中国商业统计学会） |
| 商业精英挑战赛 | `http://www.ccpitcsc.org/mcdt/4663.html`（中国贸促会商业行业委员会，物流与供应链赛项通知） |
| 数学建模竞赛 | `https://www.mcm.edu.cn/`（主办：中国工业与应用数学学会） |
| 计算机设计大赛 | `https://jsjds.blcu.edu.cn/` + 北京化工大学 2026 校赛通知（`https://cist.buct.edu.cn/2026/0317/c981a217625/pagem.htm`） |
| 东方财富杯 | `https://young.eastmoney.com/`（主办、承办与届次） |
| 模拟法庭竞赛 | `http://www.mootcourt.cn/`（主办、承办） |
| NECCS | `https://www.chinaneccs.cn/`（官网；完整主办信息未在首页核实，字段留空） |
| CATTI 杯 / 翻译大赛 | `http://www.catticenter.com/qgfyds`（全国翻译人才评价网） |
| 外研社·国才杯 | `https://uchallenge.unipus.cn/`（主办单位） |
| 中国国际大学生创新大赛 | `https://cy.ncss.cn/`（全国大学生创业服务网） |
| 挑战杯 | `https://www.tiaozhanbei.net/`（主办单位） |
| 大创 | `http://gjcxcy.bjtu.edu.cn/`（国家级大学生创新训练计划平台） |
| 职业规划大赛 | `https://zgs.chsi.com.cn/` + 教育部通知（`http://www.moe.gov.cn/srcsite/A15/s7063/202610/t20261010_1453481.html`） |
| 中金所杯 | `http://www.cffex.com/cn/jysdt/20260807/48440.html`（中国金融期货交易所） |
| 蓝桥杯 | `https://dasai.lanqiao.cn/pages/dasai/news_detail.html?id=1205`（组织机构） |
| 大广赛 | `https://www.sun-ada.net/index.php/about_intrs2.html`（参赛指南） |
| CCPC | `https://ccpc.io/` |
| 商务谈判大赛 | `https://www.negotiationchina.com/mobile/default.aspx` |
| OCALE | `https://www.ocale.net/`（主办：中国国际贸易学会，见官方 PDF 通知） |
| 公共管理案例大赛 | `https://cpipc.acge.org.cn/cw/hp/8`（参赛对象：MPA 研究生为主） |
| 三创赛 | `https://www.3chuang.net/` + 中央财经大学转发的第十六届校赛通知（时间节点） |
| 学创杯 | `http://www.xcbds.com`（转引自西安交通大学教务处 2026 通知） |
| POCIB | `https://winner.pocib.com/`（平台页面与官方 PDF 通知） |
| 服务外包创新创业大赛 | `https://www.fwwb.org.cn/`（检索时 502）+ 商务部服务贸易网报道（`https://tradeinservices.mofcom.gov.cn/article/hyly/fwwb/202609/201021.html`，主办与届次） |
| 统计建模大赛 | `http://tjjmds.ai-learning.net/`（官网检索时 404）+ 哈尔滨工业大学 2026 通知（主办、启动时间） |

### 1.3 学校官方入口（resources.json）

- 教务处：`https://jwc.suibe.edu.cn/`（含“创新创业”“互联网+创新创业大赛”栏目）
- 就业信息网：`https://job.suibe.edu.cn/`
- 团委：`https://www.suibe.edu.cn/tw/`
- 学工部（学生处）：`https://www.suibe.edu.cn/xsc/`
- 图书馆：`https://lib.suibe.edu.cn/`
- 外事处：`https://www.suibe.edu.cn/wsc/`
- 创业学院：`https://www.suibe.edu.cn/cyxy/`
- 学院站点（均已验证 200）：国际经贸学院 `/jmxy/`、工商管理学院 `/gsgl/`、金融管理学院 `/finance/`、会计学院 `/kjxy/`、法学院 `/fxy/`、国际商务外语学院 `/wyxy/`、统计与数据科学学院 `/tsxy/`、会展与传播学院 `/hzly/main.htm`、国际组织学院（贸易谈判学院）`/gjzz/`

## 2. 覆盖范围

| 文件 | 规模 | 说明 |
|---|---|---|
| `competitions.json` | **225 条**（本任务 26 条 + 并行任务 199 条官方目录层） | 本任务覆盖商科/国贸 7、数据/统计/计算机 6、金融/会计/审计 4、法学/公共管理 2、英语/翻译 3、创新创业 4；另 199 条为 `suibe-x-*` 前缀的校内竞赛奖励清单导入（见第 10 节） |
| `major-map.json` | 22 个专业 | 覆盖上经贸常见专业；含别名表与 6 个方向默认推荐 |
| `resources.json` | 47 个资源 | 校内官方 18、竞赛官网 21、外部平台 8 |

赛事类别覆盖：商科、国贸/外贸、跨境电商、数据、统计、数学、计算机、AI、算法、金融、会计、审计、法学、英语、翻译、创新创业、职业规划、公共管理（研究生）、广告/设计、商务谈判、创业模拟、物流/供应链。

## 3. 核验方法（实际执行）

1. 用检索拿到候选官方域名/通知页；
2. 用 `curl -L -A "<浏览器 UA>"` 实际抓取页面（2026-11-02），读取 `<title>` 与正文中的“主办/承办/报名/参赛对象/时间”；
3. 用 Python `json.load` 校验三个 JSON 均可解析；校验 id 唯一、`competition_ids` 与 `direction_defaults` 均引用存在的赛事、`direction_ids` 均属 6 个合法方向；
4. 对所有 URL 做 HTTP 状态复核：**54 个 URL 中 50 个返回 200，4 个非 200**（见第 5 节）。

## 4. 校内认定为什么全部是 `pending`

- 团队仓库 Issue #18 明确“竞赛目录 + 素拓认定文件”仍属待收集数据；2026-10 至今没有任何上经贸官方《竞赛目录》或《素拓/第二课堂学分认定办法》入档。
- 教务处、团委、学生处公开页面目前只有“创新创业”“互联网+”“第二课堂活动”等**入口级**信息，没有可下载的竞赛分级与加分档位表。
- 本数据**不转载**未获授权的校内加分分数、素拓学分档位或“学校认可竞赛名单”。每条赛事只写 `school_recognition.status = pending`，并注明以团委当年目录为准。
- 例外：若后续拿到官方文件，可将对应条目的 `status` 改为 `official_lead` 并填 `source_url`，其余字段不动。
- **同目录线索**：本任务执行期间，`worker/app/reference_data/` 下已存在 `suibe-official-competition-list.tsv`（234 行，按“理工/商科/实践/创新/艺术/法学/外语/文艺”分类，带 A/B/C 级）。该文件没有表头来源、发布单位或 URL，无法确认是否为团委/教务处正式发布的目录，因此**没有**据此把任何条目的 `status` 改成 `official_lead`；只在 `school_recognition.note` 里记录“目录匹配级别（来源待核验）”。匹配明细见第 8 节。

## 5. 未核实 / 已降级项（必须知道）

### 5.1 官网当前不可访问（链接仍保留，赛前必须复核）

| 赛事 | URL | 状态 | 处理 |
|---|---|---|---|
| 服务外包创新创业大赛 | `https://www.fwwb.org.cn/` | 502 | 保留链接 + `note` 说明；主办与届次来自商务部服务贸易网 |
| 统计建模大赛 | `http://tjjmds.ai-learning.net/` | 404 | 保留链接（官网域名来自高校通知）；赛程来自哈工大通知 |
| POCIB | `https://winner.pocib.com/` | 根路径 404 | 保留平台链接；赛事页面/PDF 可访问 |
| 商务谈判大赛 | `https://www.negotiationchina.com/` | 302 | 已改用移动版页面（200） |
| 审计精英挑战赛 | （无） | — | `official_url` 留空，未检索到稳定官网 |

### 5.2 字段降级

- `organizer` 留空：NECCS、CATTI 杯、商务谈判大赛、审计精英挑战赛（未在可抓取页面核实到完整主办机构）。
- `team_size` 全部留空：各赛事每年组队规则不同，未逐项核实，交由 agent 以当年通知为准。
- `timing` 写“以当年通知为准”的赛事：东方财富杯、模拟法庭、大广赛、CCPC、商务谈判、OCALE、公共管理案例、服务外包（非当届）、审计等。
- 三创赛、学创杯、统计建模、服务外包的时间来自**高校转发通知**而非官网正文，已在 `note` 注明。
- 大创的校级申报时间由学校教务处/学院通知决定，未写具体日期。

## 6. 后续补采建议（谁去补）

1. **团委 / 学生处**：索要《上海对外经贸大学学生竞赛目录》《第二课堂/素拓学分认定办法》正式文件（含赛事分级、加分档位、认定流程）→ 补齐 `school_recognition`，这是“能加分”结论唯一合法来源。
2. **教务处**：确认“互联网+”“大创”校内归口与年度时间表；补充学科竞赛立项/报销口径。
3. **各学院教务办**：补充院级选拔赛（院赛→校赛）时间与联系人，避免 agent 只推国赛。
4. **就业中心**：确认职业规划大赛校内组织方式与就业指导活动日历。
5. **数据维护人**：每年 9 月与 3 月各复核一次官网状态、报名窗口与主办单位变更；非 200 的 4 条优先复核。

## 7. 使用边界

- 本数据只回答“有哪些赛事、谁主办、大致何时、适合谁、能练什么能力”，**不回答“学校认定加多少分”**。
- agent 引用时须带 `verification_status` 与 `note`；`pending` 不得表述为“已认定/已加分”。
- 规则引擎不得把 `pending` 数据当作生产规则；演示时可显示“待核验”。
- 不包含任何真实学生数据、报名账号或个人信息。

## 8. 校内竞赛目录线索（待核验，未据此改 status）

`suibe-official-competition-list.tsv` 与本文件 26 项赛事的名称匹配结果：

| competition_id | 目录中的名称 | 目录等级 | 匹配说明 |
|---|---|---|---|
| cn-mkt-survey | 全国大学生市场调查与分析大赛 | A | 完全同名 |
| cn-business-elite | 全国高校商业精英挑战赛（品牌/会展/国贸/创新创业/会计案例） | A | 完全同名（含赛项括注） |
| cn-mcm | 全国大学生数学建模竞赛 | A | 完全同名 |
| cn-jsjds | 中国大学生计算机设计大赛 | A | 完全同名 |
| cn-tjjmds | 全国大学生统计建模竞赛 | A | 目录写作“竞赛”，公开赛事名为“大赛”，疑同一赛事 |
| cn-uchallenge | “外研社·国才杯”英语演讲/辩论/写作/阅读 | A | 同一赛事系列 |
| cn-neccs | 全国大学生英语竞赛 | B | 完全同名 |
| cn-cy-innovation | 中国国际大学生创新大赛全国总决赛 | A | 同一赛事（原“互联网+”） |
| cn-tzb | “挑战杯”中国大学生创业计划大赛 | A | 同一赛事（创业计划赛道） |
| cn-3chuang | 全国大学生电子商务“三创”挑战赛 | A | 同一赛事 |
| cn-xcb | “学创杯”全国大学生创业综合模拟大赛 | A | 完全同名 |
| cn-fwwb | 中国大学生服务外包创新创业大赛 | A | 完全同名 |
| cn-zgs-career | 全国大学生职业规划大赛 | A（实践类） | 完全同名 |
| cn-lanqiao | 蓝桥杯全国软件与信息技术专业人才大赛 | A | 完全同名 |
| cn-cpipc-mpa | 中国研究生公共管理案例大赛 | A | 完全同名（研究生） |
| cn-negotiation | 全国商务谈判大赛 | B | 名称接近，疑同一赛事 |
| cn-audit-fst | “福斯特杯”全国大学生审计精英挑战赛 | B | 目录“福斯特杯”与公开名“福思特杯”一字之差，需人工确认 |
| cn-sunada | 全国大学生广告艺术大赛上海分赛区 | B | 目录只列上海分赛区，全国赛未单列 |
| cn-mootcourt | 上海市大学生模拟法庭竞赛 | B | 目录只列上海市赛，全国赛未单列 |

目录中**未匹配到**的 7 项：`cn-eastmoney-finance`（东方财富杯）、`cn-cffex-cup`（中金所杯）、`cn-pocib`（POCIB）、`cn-ocale`（OCALE）、`cn-ccpc`（CCPC）、`cn-catti-cup`（CATTI 杯；目录另有“韩素音国际翻译大赛”B 级，属同类不同赛）、`cn-gjcxcy`（大创；目录只有“创新创业训练计划年会展示”，不是同一项目）。

**处理口径**：这些级别只写进 `school_recognition.note`，`status` 仍为 `pending`。若团队确认该 TSV 来自团委/教务处正式目录（能补 URL 或通知编号），应：
1. 把对应条目 `status` 改为 `official_lead`，`source_url` 填正式通知/文件链接；
2. 未匹配的 7 项维持 `pending`；
3. 不要据此文件里的级别推算素拓学分（目录只有级别，没有加分档位）。

## 9. 版本与维护

| 项 | 内容 |
|---|---|
| 版本 | v1（2026-11-02） |
| 规模 | 本任务 26 条 curated 赛事（文件内另有 199 条并行任务写入的官方目录层）/ 22 专业 / 47 资源 |
| 维护建议 | 每年 9 月、3 月各复核一次；官网 4 个非 200 链接优先 |
| 变更要求 | 新增赛事必须带可访问官网或可核验通知；`pending` 不得被消费方当作“已认定” |
| 责任人 | 数据接入（竞赛与校内资源）子任务；校内认定由队长对接团委/学生处确认 |

## 官方竞赛奖励清单（主控合并，2026-11-02）

- 来源：上海对外经贸大学《竞赛奖励项目清单》，公众号「SUIBE学工在线」文章截图（用户提供），逐行转录为 `suibe-official-competition-list.tsv`（235 行，含原文序号、A/B/C 等级、类别）。
- 合并方式：把清单逐项并入 `competitions.json`；已有条目补 `school_recognition.official_level/official_category/official_seq`，没有的条目按清单新建（`competition_id` 前缀 `suibe-`）。
- 当前计数：`competitions.json` 共 225 项，其中 `school_recognition.status=official_lead` 的 225 项；A/B/C 等级来自清单原文，`level`（国家级/省市级/校级）是按赛事名称推断的展示字段，不是官方认定。
- 清单只给等级，**没有给具体加分/素拓折算分数**；`school_recognition.note` 统一写明「具体加分/素拓折算以学工、团委当年文件为准」。
- 研究生/MBA/MPAcc/MIB 类赛事标记为「大三/大四」可参与；校内选拔赛/校赛标记为校级。


## 10. 并行写入说明与重复条目（需父任务合并）

### 10.1 发生了什么

本任务生成数据期间，另一个并行任务把《上海对外经贸大学竞赛奖励项目清单（SUIBE学工在线）》的 199 条记录写进了**同一个** `competitions.json`（`competition_id` 前缀 `suibe-x-`，`school_recognition.status = official_lead`，带 `official_level` A/B/C）。两边都没有删除对方的数据，当前文件是两层并集：

- `cn-*`（26 条）：本任务产出，带官网 URL、主办、时间、方向映射与技能标签；
- `suibe-x-*`（199 条）：并行任务产出，带校内奖励清单级别，但 `official_url` 多为空、`organizer` 多为空。

**该文件可能被并行任务再次覆盖。** 若发生，保留 `cn-*` 前缀的 26 条即可恢复本任务产出；本说明与 `resources.json`、`major-map.json` 不受影响。

### 10.2 疑似重复对（同一赛事的两种命名）

| 本任务 id | 官方目录层 id | 建议保留 |
|---|---|---|
| cn-3chuang | suibe-x-16 | 合并：以 suibe-x 的 `official_level` + cn 的 URL/主办/时间 |
| cn-tzb | suibe-x-8 / suibe-x-208 / suibe-x-138 | 合并：全国赛用 suibe-x-8，校内赛 suibe-x-208 保留 |
| cn-uchallenge | suibe-x-18 / suibe-x-130 | 合并：全国赛 suibe-x-18，上海赛保留 |
| cn-lanqiao | suibe-x-33 | 合并为一条 |
| cn-tjjmds | suibe-x-54 | 合并为一条 |

其余 `cn-*` 条目（市调、商业精英、数学建模、计算机设计、东方财富、模拟法庭、NECCS、CATTI、创新大赛、大创、职业规划、中金所、大广赛、CCPC、商务谈判、OCALE、公共管理案例、学创杯、POCIB、服务外包）在 `suibe-x-*` 中未找到同名全国赛条目（有的只有校内/上海赛），暂不算重复。

### 10.3 建议的合并口径（给父任务）

1. 一个赛事只保留一条：以 `suibe-x-*` 的 `school_recognition.official_level` 作为校内认定，以 `cn-*` 的 `official_url`/`organizer`/`timing`/`skill_tags`/`direction_ids` 作为公开事实；
2. 校内/上海赛与全国赛分开保留（如 `suibe-x-130` 上海赛、`suibe-x-18` 全国赛）；
3. 合并后重新跑一次 id 唯一、`major-map` 引用、方向枚举校验；
4. 不要把 `official_level` 直接换算成素拓学分（清单只有级别，没有加分档位）。
