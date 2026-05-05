/* global React, I, Icon, FLASHCARDS, PALETTE_DEFAULT, DOCS */
const { useState: useStateO, useEffect: useEffectO, useRef: useRefO, useMemo: useMemoO } = React;

// ========== Cmd+K Palette ==========
function Palette({ open, onClose, onAction }) {
  const [q, setQ] = useStateO("");
  const [sel, setSel] = useStateO(0);
  const inp = useRefO(null);

  useEffectO(() => {
    if (open) {
      setQ(""); setSel(0);
      setTimeout(() => inp.current?.focus(), 30);
    }
  }, [open]);

  const items = useMemoO(() => {
    if (!q) return PALETTE_DEFAULT;
    const ql = q.toLowerCase();
    return PALETTE_DEFAULT.filter(it => (it.title + " " + (it.sub||"")).toLowerCase().includes(ql));
  }, [q]);

  useEffectO(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") { onClose(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); setSel(s => Math.min(items.length-1, s+1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setSel(s => Math.max(0, s-1)); }
      else if (e.key === "Enter") { e.preventDefault(); items[sel] && onAction(items[sel]); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, items, sel]);

  if (!open) return null;
  const groups = [
    { label: "动作", filter: it => it.type === "action" },
    { label: "文档", filter: it => it.type === "doc" },
    { label: "搜索 & 提问", filter: it => it.type === "search" || it.type === "ask" },
  ];

  let idx = 0;
  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette" onClick={e => e.stopPropagation()}>
        <div className="pal-input">
          <span style={{color: "var(--fg-2)"}}>{I.search}</span>
          <input ref={inp} placeholder="搜索文档、跳转、提问 AI…  (尝试: 对角化)" value={q} onChange={e => { setQ(e.target.value); setSel(0); }} />
          <span style={{fontFamily:"var(--font-mono)", fontSize: 11, color:"var(--fg-3)"}}>Hybrid · 12 文档</span>
        </div>
        <div className="pal-list">
          {items.length === 0 ? (
            <div className="pal-empty">没有匹配项 · 按 Enter 直接向 AI 提问</div>
          ) : groups.map(g => {
            const gItems = items.filter(g.filter);
            if (gItems.length === 0) return null;
            return (
              <div key={g.label}>
                <div className="pal-section">{g.label}</div>
                {gItems.map(it => {
                  const my = idx++;
                  const ico = it.icon ? I[it.icon] : (it.type === "action" ? I.bolt : I.doc);
                  return (
                    <div key={it.id}
                         className={`pal-row ${my === sel ? "sel" : ""}`}
                         onMouseEnter={() => setSel(my)}
                         onClick={() => onAction(it)}>
                      <span className="ico">{ico}</span>
                      <div className="ttl">{it.title}</div>
                      <div className="sub">{it.sub}</div>
                      <span className="typ">{it.type}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="pal-foot">
          <span><kbd>↑↓</kbd> 移动</span>
          <span><kbd>↵</kbd> 选择</span>
          <span><kbd>esc</kbd> 关闭</span>
          <span style={{marginLeft: "auto"}}>Genote · v0.1 beta</span>
        </div>
      </div>
    </div>
  );
}

// ========== Flashcards ==========
function Flashcards({ onClose }) {
  const [idx, setIdx] = useStateO(0);
  const [flipped, setFlipped] = useStateO(false);
  const card = FLASHCARDS[idx];
  if (!card) {
    return (
      <div className="flash-stage">
        <div className="flash-top">
          <span style={{color:"var(--accent)"}}>{I.card}</span>
          <span className="deck">今日复习完成 ✨</span>
          <button className="close" onClick={onClose}>{I.x}</button>
        </div>
        <div className="flash-card-wrap">
          <div style={{textAlign:"center"}}>
            <div style={{fontFamily:"var(--font-read)", fontSize: 28, marginBottom: 10}}>+30 经验</div>
            <div style={{color:"var(--fg-2)", marginBottom: 18}}>共 3 张 · 用时 2m 18s · 正确率 67%</div>
            <button className="flash-show" onClick={onClose}>返回学习库</button>
          </div>
        </div>
      </div>
    );
  }

  const grade = (g) => {
    setIdx(i => i + 1);
    setFlipped(false);
  };

  return (
    <div className="flash-stage">
      <div className="flash-top">
        <span style={{color:"var(--accent)"}}>{I.card}</span>
        <span className="deck">线性代数 · 特征值与对角化</span>
        <div className="progress"><i style={{width: `${(idx/FLASHCARDS.length)*100}%`}} /></div>
        <span className="counter">{idx+1} / {FLASHCARDS.length}</span>
        <button className="close" onClick={onClose}>{I.x}</button>
      </div>
      <div className="flash-card-wrap">
        <div className={`flash-card ${flipped ? "flipped" : ""}`}>
          <div className="meta">
            <div className="src"><span style={{color:"var(--fg-2)"}}>{I.doc}</span> {card.src}</div>
            <span>下次复习 · {card.next}</span>
          </div>
          <div className="question">{card.q}</div>
          {flipped && (
            <div className="answer">
              <h4>参考答案</h4>
              {card.a.split("\n\n").map((p, i) => <p key={i} style={{margin: "0 0 8px"}}>{p}</p>)}
            </div>
          )}
        </div>
      </div>
      {!flipped ? (
        <div className="flash-actions">
          <button className="flash-show" onClick={() => setFlipped(true)}>显示答案 (空格)</button>
        </div>
      ) : (
        <div className="flash-actions">
          <button className="flash-grade again" onClick={() => grade("again")}><span className="lbl">忘了</span><span className="next">&lt; 1m</span></button>
          <button className="flash-grade hard" onClick={() => grade("hard")}><span className="lbl">困难</span><span className="next">10m</span></button>
          <button className="flash-grade good" onClick={() => grade("good")}><span className="lbl">良好</span><span className="next">3 天</span></button>
          <button className="flash-grade easy" onClick={() => grade("easy")}><span className="lbl">简单</span><span className="next">7 天</span></button>
        </div>
      )}
    </div>
  );
}

// ========== Upload modal ==========
function UploadModal({ open, onClose, onComplete }) {
  const [stage, setStage] = useStateO("idle"); // idle | uploading | parsing | embedding | done
  const [pct, setPct] = useStateO(0);

  useEffectO(() => {
    if (!open) { setStage("idle"); setPct(0); return; }
  }, [open]);

  const start = () => {
    setStage("uploading"); setPct(0);
    let p = 0;
    const tick = () => {
      p += Math.random() * 14 + 4;
      if (p > 100) p = 100;
      setPct(Math.floor(p));
      if (p >= 100) {
        setStage(s => {
          if (s === "uploading") { setPct(0); setTimeout(tick, 200); return "parsing"; }
          if (s === "parsing")   { setPct(0); setTimeout(tick, 200); return "embedding"; }
          if (s === "embedding") { return "done"; }
          return s;
        });
      } else {
        setTimeout(tick, 180);
      }
    };
    tick();
  };

  if (!open) return null;
  const stages = [
    { id: "uploading", label: "上传文件", desc: "传输至服务器…" },
    { id: "parsing", label: "解析与切分", desc: "PyMuPDF · 段落级语义切分" },
    { id: "embedding", label: "向量化 & 索引", desc: "BAAI/bge-m3 → Qdrant" },
  ];
  const curIdx = stages.findIndex(s => s.id === stage);

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette" style={{width: 540}} onClick={e => e.stopPropagation()}>
        <div className="pal-input" style={{borderBottom: "1px solid var(--line-soft)"}}>
          <span style={{color:"var(--accent)"}}>{I.upload}</span>
          <span style={{flex: 1, fontSize: 14}}>上传新文档</span>
          <button className="t-btn" onClick={onClose}>{I.x}</button>
        </div>
        {stage === "idle" && (
          <div style={{padding: 24}}>
            <div className="uploader" style={{margin: 0}} onClick={start}>
              <div className="big">点击或拖拽上传</div>
              <div className="small">支持 PDF / DOCX / MP4 / MP3 / JPG · 单文件 ≤ 200MB</div>
              <div className="types">
                <span>毛中特讲义.pdf</span>
                <span style={{color:"var(--accent)"}}>已选 1 个文件 · 18.2 MB</span>
              </div>
            </div>
            <button className="cta" style={{width:"100%", padding: 10, marginTop: 16, background: "var(--accent)", color: "var(--accent-ink)", borderRadius: 8, fontWeight: 600}} onClick={start}>
              开始上传与索引
            </button>
          </div>
        )}
        {stage !== "idle" && stage !== "done" && (
          <div style={{padding: 24}}>
            {stages.map((s, i) => (
              <div key={s.id} style={{
                display:"flex", alignItems:"center", gap: 12,
                padding: "12px 0", borderBottom: i < stages.length-1 ? "1px dashed var(--line-soft)" : "none",
                opacity: i > curIdx ? 0.45 : 1,
              }}>
                <div style={{
                  width: 24, height: 24, borderRadius: "50%",
                  background: i < curIdx ? "var(--accent)" : i === curIdx ? "var(--accent-soft)" : "var(--bg-2)",
                  color: i < curIdx ? "var(--accent-ink)" : "var(--accent)",
                  display: "grid", placeItems:"center",
                  fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600,
                  border: i === curIdx ? "1px solid var(--accent-line)" : "none",
                }}>
                  {i < curIdx ? "✓" : i+1}
                </div>
                <div style={{flex: 1}}>
                  <div style={{fontSize: 13, fontWeight: 500}}>{s.label}</div>
                  <div style={{fontSize: 11, color: "var(--fg-3)", fontFamily: "var(--font-mono)"}}>{s.desc}</div>
                </div>
                {i === curIdx && (
                  <div style={{width: 100}}>
                    <div className="progress" style={{height: 4, background:"var(--bg-2)", borderRadius: 99, overflow: "hidden"}}>
                      <i style={{display:"block", width:`${pct}%`, height: "100%", background: "var(--accent)"}} />
                    </div>
                    <div style={{fontFamily:"var(--font-mono)", fontSize: 10.5, color:"var(--fg-3)", textAlign:"right", marginTop: 4}}>{pct}%</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {stage === "done" && (
          <div style={{padding: 32, textAlign:"center"}}>
            <div style={{fontSize: 32, marginBottom: 6}}>✓</div>
            <div style={{fontFamily:"var(--font-read)", fontSize: 18, marginBottom: 4}}>索引完成</div>
            <div style={{color:"var(--fg-2)", fontSize: 12.5, marginBottom: 18}}>632 个段落 · 632 向量已写入 Qdrant</div>
            <button className="flash-show" onClick={onComplete}>打开文档 →</button>
          </div>
        )}
      </div>
    </div>
  );
}

window.Palette = Palette;
window.Flashcards = Flashcards;
window.UploadModal = UploadModal;
