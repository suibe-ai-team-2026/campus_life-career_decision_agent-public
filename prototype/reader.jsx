/* global React, I, Icon, fmt, OUTLINE, PDF_CHAT, NOTES_INIT */
const { useState: useStateP, useEffect: useEffectP, useRef: useRefP, useCallback: useCallbackP } = React;

// ========== PDF Reader (split-pane: doc + chat/notes) ==========
function PdfReader({ doc, focusMode, onCite, splitPx, setSplitPx, rightTab, setRightTab }) {
  const [page, setPage] = useStateP(94);
  const [zoom, setZoom] = useStateP(100);
  const [activeOutline, setActiveOutline] = useStateP("o1-3");

  return (
    <div className={`reader ${focusMode === "right-only" ? "focus-hide-right" : ""}`}
         style={{"--split-r": `${splitPx}px`}}>
      <div className="doc-pane">
        <DocToolbar
          doc={doc}
          page={page} setPage={setPage}
          zoom={zoom} setZoom={setZoom}
          rightTab={rightTab} setRightTab={setRightTab}
        />
        <div className="pdf-canvas" style={{fontSize: `${zoom}%`}}>
          <PdfPage pageNum={94} zoom={zoom} onCite={onCite} />
        </div>
      </div>

      <Splitter onDrag={(dx) => setSplitPx(p => Math.max(360, Math.min(820, p - dx)))} />

      <div className="right-pane">
        <RightTabs tab={rightTab} setTab={setRightTab} />
        {rightTab === "chat" && <ChatPanel initialChat={PDF_CHAT} contextLabel={doc.title} variant="pdf" />}
        {rightTab === "notes" && <NotesPanel />}
        {rightTab === "outline" && <Outline active={activeOutline} setActive={(id, p) => { setActiveOutline(id); setPage(p); }} />}
      </div>
    </div>
  );
}

function DocToolbar({ doc, page, setPage, zoom, setZoom }) {
  return (
    <div className="doc-toolbar">
      <div className="tt-grp">
        <button className="ico-btn" title="书签">{I.pin}</button>
        <button className="ico-btn" title="高亮">{I.highlight}</button>
        <button className="ico-btn" title="复制">{I.copy}</button>
      </div>
      <div className="tt-grp">
        <button className="ico-btn" onClick={() => setPage(p => Math.max(1, p-1))} title="上一页">{I.arrowLeft}</button>
        <div className="pages">
          <input value={page} onChange={e => setPage(+e.target.value || 1)} />
          <span>/ {doc.pages}</span>
        </div>
        <button className="ico-btn" onClick={() => setPage(p => Math.min(doc.pages, p+1))} title="下一页">{I.arrowRight}</button>
      </div>
      <div className="tt-grp">
        <button className="ico-btn" onClick={() => setZoom(z => Math.max(60, z-10))}>{I.zoomOut}</button>
        <span className="zoom">{zoom}%</span>
        <button className="ico-btn" onClick={() => setZoom(z => Math.min(180, z+10))}>{I.zoomIn}</button>
      </div>
      <div className="spacer" />
      <span className="doc-title"><b>{doc.title}</b> · 第 3 章</span>
    </div>
  );
}

function PdfPage({ pageNum, zoom, onCite }) {
  return (
    <div className="pdf-page" style={{transform: `scale(${zoom/100})`, transformOrigin: "top center"}}>
      <span className="pg-num">— {pageNum} —</span>
      <h1>3.2.1 可对角化的判定</h1>
      <p className="subtitle">第三章 矩阵的特征值与特征向量</p>

      <p>设 <code style={{fontFamily:"var(--font-mono)"}}>A</code> 是 n 阶方阵。若存在可逆矩阵 P，使得 P⁻¹AP = Λ 为对角阵，则称 A 可对角化（diagonalizable）。本节讨论可对角化的判定方法及其应用。</p>

      <h2>定理 3.2.1（可对角化的充要条件）</h2>
      <p><mark className="cited" onClick={() => onCite && onCite("p.94 · 定理 3.2.1")}>n 阶方阵 A 可对角化的充要条件是 A 有 n 个线性无关的特征向量。</mark>等价地，对每一个 k 重特征值 λᵢ，齐次方程组 (A - λᵢE)x = 0 的基础解系恰好包含 k 个向量。</p>

      <p>证明：必要性显然——若 P⁻¹AP=Λ，则 AP=PΛ。把 P 按列分块写成 (p₁, p₂, ..., pₙ)，则 Apᵢ=λᵢpᵢ，即每一个 pᵢ 都是 A 的特征向量。由 P 可逆知 p₁, …, pₙ 线性无关。</p>

      <p>充分性：将 A 的 n 个线性无关特征向量按列拼成矩阵 P，则 P 可逆，且 AP=PΛ，故 P⁻¹AP=Λ。<mark className="user-note" title="你的笔记 · 5 月 3 日">这个证明思路常被命题人改造为大题。</mark></p>

      <div className="formula">|A − λE| = 0 &nbsp;⇔&nbsp; ∏(λ − λᵢ)<sup>kᵢ</sup> = 0</div>

      <h2>推论</h2>
      <p>（1）若 A 的 n 个特征值两两不同，则 A 必可对角化。</p>
      <p>（2）<mark className="cited" onClick={() => onCite && onCite("p.94 · 推论 (2)")}>实对称矩阵一定可正交对角化，即存在正交矩阵 Q 使 QᵀAQ = Λ。</mark></p>
      <p>（3）若 A 不可对角化，则其 Jordan 标准型至少含一个阶数 ≥ 2 的 Jordan 块。</p>
    </div>
  );
}

// ========== Splitter ==========
function Splitter({ onDrag }) {
  const [drag, setDrag] = useStateP(false);
  const startX = useRefP(0);
  useEffectP(() => {
    if (!drag) return;
    const move = (e) => { const dx = e.clientX - startX.current; startX.current = e.clientX; onDrag(dx); };
    const up = () => setDrag(false);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, [drag]);
  return (
    <div className={`splitter ${drag ? "dragging" : ""}`}
         onMouseDown={(e) => { startX.current = e.clientX; setDrag(true); }} />
  );
}

// ========== Right tabs ==========
function RightTabs({ tab, setTab }) {
  const tabs = [
    { id: "chat", label: "AI 助手", icon: I.msg, badge: "12" },
    { id: "notes", label: "笔记", icon: I.pen, badge: "" },
    { id: "outline", label: "目录", icon: I.list, badge: "" },
  ];
  return (
    <div className="tabs">
      {tabs.map(t => (
        <button key={t.id} className={`tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
          <span style={{display: "inline-flex"}}>{t.icon}</span>
          {t.label}
          {t.badge && <span className="badge">{t.badge}</span>}
        </button>
      ))}
    </div>
  );
}

// ========== Chat panel (shared) ==========
function ChatPanel({ initialChat, contextLabel, variant, onJumpVideo }) {
  const [chat, setChat] = useStateP(initialChat);
  const [input, setInput] = useStateP("");
  const [thinking, setThinking] = useStateP(false);
  const [showCtx, setShowCtx] = useStateP(true);
  const histRef = useRefP(null);

  useEffectP(() => {
    if (histRef.current) histRef.current.scrollTop = histRef.current.scrollHeight;
  }, [chat, thinking]);

  // Simulate trailing assistant turn for "做几道题目让我练手"
  useEffectP(() => {
    if (variant === "pdf" && initialChat[initialChat.length-1]?.role === "user" && !thinking) {
      const t = setTimeout(() => {
        setThinking(true);
        setTimeout(() => {
          setThinking(false);
          setChat(c => [...c, {
            role: "assistant",
            text: "好的，根据 **第三章** 真题题库，我挑了 3 道经典题，按难度递增排列：\n\n**① (2018·一)** 设 A 为 3 阶矩阵，r(A)=2，且 Aα=2α 有非零解 α。求 A 的所有特征值。\n\n**② (2021·一)** 已知 A=⎡1 2 0; 2 1 0; 0 0 3⎤，求正交矩阵 Q 使 QᵀAQ 为对角阵。\n\n**③ (2023·一)** 若 A、B 同时可对角化，证明 AB=BA 当且仅当存在 P 同时对角化二者。",
            citations: [
              { src: "考研数学一", loc: "p.170" },
              { src: "考研数学一", loc: "p.184" },
              { src: "考研数学一", loc: "p.196" },
            ],
          }]);
        }, 1400);
      }, 250);
      return () => clearTimeout(t);
    }
  }, []);

  const send = () => {
    if (!input.trim()) return;
    const q = input.trim();
    setChat(c => [...c, { role: "user", text: q }]);
    setInput("");
    setThinking(true);
    setTimeout(() => {
      setThinking(false);
      setChat(c => [...c, {
        role: "assistant",
        text: "我在文档与转录中找到 **6 处** 相关上下文。简要回答：" + mockAnswer(q) + "\n\n如果想看更多例题或推导细节，告诉我。",
        citations: variant === "video"
          ? [{ src: "线代串讲", loc: "06:52", ts: 412 }, { src: "考研数学一", loc: "p.88" }]
          : [{ src: "考研数学一", loc: "p.92" }, { src: "考研数学一", loc: "p.94" }],
      }]);
    }, 1100);
  };

  return (
    <div className="chat">
      <div className="chat-history" ref={histRef}>
        {chat.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            <div className="who">{m.role === "user" ? "你" : "知途 · DeepSeek-V3"}</div>
            <div className="body" dangerouslySetInnerHTML={{__html: renderMd(m.text)}} />
            {m.citations && (
              <div className="citations">
                {m.citations.map((c, j) => (
                  <button key={j} className="cite"
                          onClick={() => variant === "video" && c.ts != null ? onJumpVideo?.(c.ts) : null}>
                    <span className="src">{c.src}</span>
                    <span className="ts">{c.loc}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        {thinking && (
          <div className="bubble assistant">
            <div className="who">知途 · DeepSeek-V3</div>
            <div className="thinking"><i/><i/><i/></div>
          </div>
        )}
      </div>

      <div className="composer">
        {showCtx && (
          <span className="ctx-chip">
            ↪ 上下文：{contextLabel}
            <button className="x" onClick={() => setShowCtx(false)}>{I.x}</button>
          </span>
        )}
        <div className="input-wrap">
          <textarea
            placeholder={variant === "video" ? "向视频提问，例如：跳到讲『迹与行列式关系』那一段" : "向文档提问，按 Enter 发送…"}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            rows={1}
          />
          <button className="send" onClick={send} disabled={!input.trim()}>{I.send2}</button>
        </div>
        <div className="hint">
          <div className="quick">
            <button onClick={() => setInput("帮我总结这一节的考点")}>总结考点</button>
            <button onClick={() => setInput("出 3 道相关真题练手")}>出真题</button>
            <button onClick={() => setInput("这部分有哪些常见易错点？")}>易错点</button>
          </div>
          <div>Hybrid Search · 12 引用源</div>
        </div>
      </div>
    </div>
  );
}

function mockAnswer(q) {
  if (/对角化|相似/.test(q)) return "若 A 有 n 个线性无关特征向量则可对角化；实对称矩阵一定可正交对角化。";
  if (/迹|行列式/.test(q)) return "Σλᵢ = tr(A)，Πλᵢ = |A|。";
  if (/真题|题目|练/.test(q)) return "我挑了 3 道难度递增的真题（2018/2021/2023）。";
  return "已检索 12 个相关段落，结论是这一节的判定定理在历年真题中出现 7 次（2017–2024）。";
}

function renderMd(t) {
  return t
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br/>");
}

// ========== Notes ==========
function NotesPanel() {
  const [saving, setSaving] = useStateP(false);
  const [savedAt, setSavedAt] = useStateP("刚刚");
  const tRef = useRefP(null);
  const onInput = useCallbackP(() => {
    setSaving(true);
    clearTimeout(tRef.current);
    tRef.current = setTimeout(() => {
      setSaving(false);
      setSavedAt("刚刚");
    }, 700);
  }, []);
  return (
    <div className="notes">
      <div className="notes-meta">
        <span className={`saved-dot ${saving ? "saving" : ""}`} />
        {saving ? "正在自动保存…" : `已保存 · ${savedAt}`}
        <span style={{marginLeft: "auto"}}>248 字 · 3 引用</span>
      </div>
      <div className="notes-editor"
           contentEditable
           suppressContentEditableWarning
           onInput={onInput}
           dangerouslySetInnerHTML={{__html: NOTES_INIT}} />
    </div>
  );
}

// ========== Outline ==========
function Outline({ active, setActive }) {
  return (
    <div className="outline">
      {OUTLINE.map(o => (
        <button key={o.id}
                className={`outline-item l${o.lvl} ${active === o.id ? "active" : ""}`}
                onClick={() => setActive(o.id, o.page)}>
          <span style={{flex: 1, textAlign: "left"}}>{o.title}</span>
          <span className="pg">p.{o.page}</span>
        </button>
      ))}
    </div>
  );
}

window.PdfReader = PdfReader;
window.ChatPanel = ChatPanel;
window.Splitter = Splitter;
window.RightTabs = RightTabs;
window.NotesPanel = NotesPanel;
window.Outline = Outline;
