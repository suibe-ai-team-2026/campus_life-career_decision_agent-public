/* global React */
const { useState: useStateD, useEffect: useEffectD, useMemo: useMemoD } = React;

// ---------- Mock data ----------
const DOCS = [
  {
    id: "doc-kaoyan-math",
    type: "pdf",
    title: "考研数学一·真题精讲（2018-2024）",
    subject: "数学一",
    pages: 412,
    progress: 0.34,
    lastOpened: "今天 10:32",
    sizeMB: 18.2,
    chunks: 1842,
    indexed: true,
  },
  {
    id: "doc-mzdsz",
    type: "pdf",
    title: "毛中特·重点章节梳理",
    subject: "政治",
    pages: 168,
    progress: 0.62,
    lastOpened: "昨天 21:14",
    sizeMB: 6.4,
    chunks: 632,
    indexed: true,
  },
  {
    id: "doc-gongka-shenlun",
    type: "pdf",
    title: "国考申论·5年范文 + 阅卷标准",
    subject: "申论",
    pages: 96,
    progress: 0.18,
    lastOpened: "5月3日",
    sizeMB: 4.1,
    chunks: 388,
    indexed: true,
  },
  {
    id: "vid-zhuanglie",
    type: "video",
    title: "张老师·线性代数串讲（特征值与二次型）",
    subject: "数学一",
    durationSec: 9420, // 2:37:00
    progress: 0.41,
    lastOpened: "今天 14:08",
    sizeMB: 1240,
    chunks: 78,
    indexed: true,
  },
  {
    id: "vid-shizheng",
    type: "video",
    title: "2025 时政热点 · 二十届三中全会精神（录播）",
    subject: "政治",
    durationSec: 5760, // 1:36:00
    progress: 0.08,
    lastOpened: "5月2日",
    sizeMB: 820,
    chunks: 48,
    indexed: false, // still indexing
  },
  {
    id: "aud-mock",
    type: "audio",
    title: "5月3日·公考面试模拟（录音）",
    subject: "面试",
    durationSec: 4140,
    progress: 0,
    lastOpened: "5月3日",
    sizeMB: 92,
    chunks: 24,
    indexed: true,
  },
];

// PDF outline (matches doc-kaoyan-math)
const OUTLINE = [
  { id: "o1", lvl: 1, title: "第三章 矩阵的特征值与特征向量", page: 78 },
  { id: "o1-1", lvl: 2, title: "3.1 特征值与特征向量的概念", page: 80 },
  { id: "o1-2", lvl: 2, title: "3.2 相似矩阵与对角化", page: 92 },
  { id: "o1-3", lvl: 3, title: "3.2.1 可对角化的判定", page: 94 },
  { id: "o1-4", lvl: 3, title: "3.2.2 实对称矩阵的对角化", page: 101 },
  { id: "o1-5", lvl: 2, title: "3.3 二次型与正定性", page: 112 },
  { id: "o2", lvl: 1, title: "第四章 线性方程组", page: 128 },
  { id: "o2-1", lvl: 2, title: "4.1 齐次方程组的解空间", page: 130 },
  { id: "o2-2", lvl: 2, title: "4.2 非齐次方程组", page: 142 },
  { id: "o3", lvl: 1, title: "第五章 真题精讲", page: 168 },
  { id: "o3-1", lvl: 2, title: "5.1 2024 年真题（一）", page: 170 },
  { id: "o3-2", lvl: 2, title: "5.2 2023 年真题（一）", page: 184 },
];

// Video transcript segments (timestamp-aligned chunks)
const TRANSCRIPT = [
  { t: 0,    text: "好，同学们，我们今天来讲特征值与特征向量。这一块在考研数学一里面几乎每年都会考，分值在 10-15 分之间。" },
  { t: 18,   text: "首先复习一下定义：设 A 是 n 阶方阵，如果存在数 λ 和非零向量 x，使得 Ax = λx，那么 λ 就叫做 A 的特征值，x 是对应的特征向量。" },
  { t: 64,   text: "注意三个关键点：第一，A 必须是方阵；第二，x 一定是非零向量，零向量不算；第三，特征值可以是 0，但特征向量不能是零。" },
  { t: 142,  text: "下面我们看怎么求特征值。把 Ax = λx 移项变成 (A - λE)x = 0，这是一个齐次线性方程组。" },
  { t: 198,  text: "它有非零解的条件是什么？系数行列式等于 0，也就是 |A - λE| = 0。这个方程叫做 A 的特征方程，左边是关于 λ 的 n 次多项式。" },
  { t: 276,  text: "我们来看一道 2023 年的真题：A 是一个 3 阶矩阵，已知它的三个特征值分别是 1、-1、2，求 |A + 2E| 的值。" },
  { t: 340,  text: "解题思路：A + 2E 的特征值就是 A 的特征值加 2，也就是 3、1、4。行列式等于特征值的乘积，所以 |A + 2E| = 3 × 1 × 4 = 12。" },
  { t: 412,  text: "再讲一个非常重要的性质：特征值的和等于矩阵的迹，特征值的积等于行列式。这两条性质几乎每次大题都用得上。" },
  { t: 488,  text: "接下来是相似对角化。如果 A 能找到一个可逆矩阵 P，使得 P⁻¹AP = Λ 是对角阵，那么 A 就叫做可对角化的矩阵。" },
  { t: 564,  text: "可对角化的充要条件：n 阶方阵 A 有 n 个线性无关的特征向量。等价说法是每一个 ki 重特征值都恰好对应 ki 个线性无关的特征向量。" },
  { t: 642,  text: "对于实对称矩阵，结论更强：实对称矩阵一定可以正交对角化，也就是说存在正交矩阵 Q 使得 Q⁻¹AQ = QᵀAQ = Λ。" },
];

// Mock chat history for the PDF doc
const PDF_CHAT = [
  {
    role: "user",
    text: "把第三章 3.2 节『相似矩阵与对角化』的核心结论用三句话概括一下。"
  },
  {
    role: "assistant",
    text: "**三句话概括**：（1）若 n 阶方阵 A 与对角阵相似，则 A 称为**可对角化**的，且 P⁻¹AP=Λ，其中 P 的列向量为 A 的 n 个线性无关的特征向量。（2）A 可对角化的**充要条件**是 A 有 n 个线性无关的特征向量；等价说法是每一个 k 重特征值恰好对应 k 个线性无关的特征向量。（3)**实对称矩阵**一定可以正交对角化，即存在正交矩阵 Q 使 QᵀAQ=Λ。",
    citations: [
      { src: "考研数学一", loc: "p.92" },
      { src: "考研数学一", loc: "p.94" },
      { src: "考研数学一", loc: "p.101" },
    ],
  },
  {
    role: "user",
    text: "做几道相关的真题题目让我练手。"
  },
];

// Video chat with timestamp citations
const VIDEO_CHAT = [
  {
    role: "user",
    text: "刚才老师讲的『特征值的和等于矩阵的迹』在视频哪里？给我跳过去。",
  },
  {
    role: "assistant",
    text: "在 **06:52** 处张老师明确说："+
      '"特征值的和等于矩阵的迹，特征值的积等于行列式。这两条性质几乎每次大题都用得上。"\n\n这条性质对应教材 **p.88** 的定理 3.4。建议你先把这条记牢，下面 09:24 处他立刻用一道 2023 真题做了应用。',
    citations: [
      { src: "线代串讲", loc: "06:52", ts: 412 },
      { src: "线代串讲", loc: "09:24", ts: 564 },
      { src: "考研数学一", loc: "p.88" },
    ],
  },
];

// Notes initial content
const NOTES_INIT = `<h1>线性代数 · 特征值与对角化</h1>
<p><em>来源：张老师线代串讲 + 教材第三章</em></p>

<h2>1. 核心定义</h2>
<ul>
<li>设 A 是 n 阶方阵，若存在 λ 与非零向量 x 使 Ax = λx，则 λ 是 <strong>特征值</strong>，x 是 <strong>特征向量</strong>。</li>
<li>特征方程：|A - λE| = 0。</li>
</ul>

<blockquote>
"注意三个关键点：第一，A 必须是方阵；第二，x 一定是非零向量；第三，特征值可以是 0，但特征向量不能是零。"
<span class="ts">→ 视频 01:04 · 张老师线代串讲</span>
</blockquote>

<h2>2. 必背性质</h2>
<ul>
<li>Σλᵢ = tr(A)（迹）</li>
<li>Πλᵢ = |A|（行列式）</li>
<li>实对称矩阵 → 一定可正交对角化</li>
</ul>

<h2>3. 待复习</h2>
<ul>
<li>2024 年真题第 13 题（p.170）</li>
<li>"二次型正定的判别"还没整理</li>
</ul>`;

// Flashcards
const FLASHCARDS = [
  {
    id: "fc1",
    q: "特征值与特征向量的定义条件中，必须满足的三个关键点是什么？",
    a: "（1）A 必须是 n 阶方阵；（2）特征向量 x 必须是非零向量；（3）特征值 λ 可以为 0，但 x 不能为零向量。",
    src: "考研数学一 · p.80",
    next: "明天",
  },
  {
    id: "fc2",
    q: "n 阶方阵 A 可对角化的充要条件是什么？",
    a: "A 有 n 个线性无关的特征向量。等价表述：每一个 k 重特征值恰好对应 k 个线性无关的特征向量。",
    src: "考研数学一 · p.94",
    next: "3 天后",
  },
  {
    id: "fc3",
    q: "已知 3 阶矩阵 A 的特征值为 1, -1, 2。求 |A + 2E|。",
    a: "A + 2E 的特征值为 3, 1, 4。|A + 2E| = 3 × 1 × 4 = 12。\n\n核心：A 与 f(A) 共享特征向量；A 的特征值代入 f 即得 f(A) 的特征值。",
    src: "线代串讲 · 04:36",
    next: "明天",
  },
];

// Cmd-K palette items
const PALETTE_DEFAULT = [
  { type: "action", id: "go-library", title: "返回 学习库", sub: "Library" },
  { type: "action", id: "open-flash", title: "开始 闪卡复习", sub: "复习 12 张待复习" },
  { type: "action", id: "open-upload", title: "上传新文档", sub: "PDF / 视频 / 音频" },
  { type: "action", id: "toggle-focus", title: "切换专注模式", sub: "隐藏侧栏与工具" },
  { type: "doc", id: "doc-kaoyan-math", title: "考研数学一·真题精讲", sub: "PDF · 412 页", icon: "doc" },
  { type: "doc", id: "vid-zhuanglie", title: "张老师·线性代数串讲", sub: "视频 · 2:37:00", icon: "video" },
  { type: "doc", id: "doc-mzdsz", title: "毛中特·重点章节", sub: "PDF · 168 页", icon: "doc" },
  { type: "doc", id: "vid-shizheng", title: "时政热点·二十届三中全会", sub: "视频 · 1:36:00", icon: "video" },
  { type: "search", id: "s1", title: "在『考研数学一』中搜索…", sub: "Hybrid Search · BM25 + 向量", icon: "search" },
  { type: "search", id: "s2", title: "在『线代串讲』转录中搜索…", sub: "时间戳同步", icon: "search" },
  { type: "ask", id: "ask-1", title: "向 AI 提问：可对角化的判定条件", sub: "DeepSeek-V3 · 含 12 引用源", icon: "msg" },
];

window.DOCS = DOCS;
window.OUTLINE = OUTLINE;
window.TRANSCRIPT = TRANSCRIPT;
window.PDF_CHAT = PDF_CHAT;
window.VIDEO_CHAT = VIDEO_CHAT;
window.NOTES_INIT = NOTES_INIT;
window.FLASHCARDS = FLASHCARDS;
window.PALETTE_DEFAULT = PALETTE_DEFAULT;
