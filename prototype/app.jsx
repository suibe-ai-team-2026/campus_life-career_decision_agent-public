/* global React, ReactDOM, I, Icon, fmt, DOCS, Library, PdfReader, VideoReader, Palette, Flashcards, UploadModal, NotesPanel, useTweaks, TweaksPanel, TweakSection, TweakSlider, TweakToggle, TweakRadio, TweakColor, TweakSelect */
const { useState: useStateA, useEffect: useEffectA, useRef: useRefA, useCallback: useCallbackA } = React;

// expose NotesPanel globally for video.jsx
window.NotesPanel = window.NotesPanel || (() => null);

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accentHue": 62,
  "density": "comfy",
  "splitPx": 480,
  "focusMode": "off",
  "showCheckin": true
}/*EDITMODE-END*/;

function App() {
  const [view, setView] = useStateA("library"); // library | reader
  const [activeDocId, setActiveDocId] = useStateA("doc-kaoyan-math");
  const [rightTab, setRightTab] = useStateA("chat");
  const [paletteOpen, setPaletteOpen] = useStateA(false);
  const [uploadOpen, setUploadOpen] = useStateA(false);
  const [flashOpen, setFlashOpen] = useStateA(false);
  const [checkedIn, setCheckedIn] = useStateA(false);
  const [toasts, setToasts] = useStateA([]);
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);

  const activeDoc = DOCS.find(d => d.id === activeDocId) || DOCS[0];

  // Apply tweaks to CSS vars
  useEffectA(() => {
    document.documentElement.style.setProperty("--accent-h", tweaks.accentHue);
    if (tweaks.density === "compact") {
      document.body.style.fontSize = "13px";
    } else {
      document.body.style.fontSize = "14px";
    }
  }, [tweaks]);

  const [splitPx, setSplitPx] = useStateA(TWEAK_DEFAULTS.splitPx);
  useEffectA(() => { setSplitPx(tweaks.splitPx); }, [tweaks.splitPx]);

  const focusMode = tweaks.focusMode; // off | sidebar-hidden | right-only

  // Cmd+K
  useEffectA(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault(); setPaletteOpen(o => !o);
      }
      if (e.key === "Escape" && paletteOpen) setPaletteOpen(false);
      if ((e.metaKey || e.ctrlKey) && e.key === ".") {
        e.preventDefault();
        setTweak("focusMode", focusMode === "off" ? "sidebar-hidden" : "off");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen, focusMode]);

  const pushToast = (msg, ok) => {
    const id = Math.random();
    setToasts(t => [...t, { id, msg, ok }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2800);
  };

  const openDoc = (id) => {
    setActiveDocId(id);
    setView("reader");
  };

  const onPaletteAction = (it) => {
    setPaletteOpen(false);
    if (it.type === "doc") openDoc(it.id);
    else if (it.id === "go-library") setView("library");
    else if (it.id === "open-flash") setFlashOpen(true);
    else if (it.id === "open-upload") setUploadOpen(true);
    else if (it.id === "toggle-focus") setTweak("focusMode", focusMode === "off" ? "sidebar-hidden" : "off");
    else pushToast("已发送给 AI 助手", true);
  };

  const sidebarHidden = focusMode === "sidebar-hidden" || focusMode === "right-only";

  return (
    <div className={`app ${sidebarHidden ? "focus" : ""}`}>
      <Titlebar
        view={view} setView={setView} activeDoc={activeDoc}
        onPalette={() => setPaletteOpen(true)}
        focusMode={focusMode} setFocusMode={(v) => setTweak("focusMode", v)}
      />
      {/* Always render Sidebar — CSS rule `.app.focus .sidebar { display: none }`
          handles hiding it. Conditionally removing the element shifted .main to
          the 0-width grid column and made the reader collapse to 0px width. */}
      <Sidebar
        activeDocId={activeDocId} view={view}
        onSelectDoc={openDoc}
        onLibrary={() => setView("library")}
        onPalette={() => setPaletteOpen(true)}
        onUpload={() => setUploadOpen(true)}
        onFlash={() => setFlashOpen(true)}
      />
      <div className="main">
        {view === "library" && (
          <Library
            onOpen={openDoc}
            onUpload={() => setUploadOpen(true)}
            onStartFlash={() => setFlashOpen(true)}
            onCheckin={() => { setCheckedIn(true); pushToast("✓ 签到成功 · +2 经验", true); }}
            checkedIn={checkedIn}
          />
        )}
        {view === "reader" && activeDoc.type === "pdf" && (
          <PdfReader doc={activeDoc} focusMode={focusMode}
                     splitPx={splitPx} setSplitPx={setSplitPx}
                     rightTab={rightTab} setRightTab={setRightTab}
                     onCite={(loc) => pushToast(`引用已添加到笔记 · ${loc}`, true)} />
        )}
        {view === "reader" && activeDoc.type === "video" && (
          <VideoReader doc={activeDoc} focusMode={focusMode}
                       splitPx={splitPx} setSplitPx={setSplitPx}
                       rightTab={rightTab} setRightTab={setRightTab} />
        )}
        <Status view={view} activeDoc={activeDoc} />
      </div>

      <Palette open={paletteOpen} onClose={() => setPaletteOpen(false)} onAction={onPaletteAction} />
      {flashOpen && <Flashcards onClose={() => setFlashOpen(false)} />}
      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} onComplete={() => { setUploadOpen(false); pushToast("文档已加入学习库", true); }} />

      <div className="toasts">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.ok ? "ok" : ""}`}>
            <span className="dot" />{t.msg}
          </div>
        ))}
      </div>

      <TweaksPanel title="Tweaks · Genote">
        <TweakSection title="主题与色彩">
          <TweakSlider label="强调色色相 (oklch hue)" value={tweaks.accentHue} min={20} max={320} step={2}
            onChange={v => setTweak("accentHue", v)} />
          <TweakRadio label="密度" value={tweaks.density}
            options={[{value:"comfy",label:"舒适"},{value:"compact",label:"紧凑"}]}
            onChange={v => setTweak("density", v)} />
        </TweakSection>
        <TweakSection title="布局">
          <TweakSlider label="右侧面板宽度 (px)" value={tweaks.splitPx} min={360} max={780} step={10}
            onChange={v => setTweak("splitPx", v)} />
          <TweakSelect label="专注模式" value={tweaks.focusMode}
            options={[
              {value:"off",label:"关闭"},
              {value:"sidebar-hidden",label:"隐藏侧栏"},
              {value:"right-only",label:"仅文档（最专注）"},
            ]}
            onChange={v => setTweak("focusMode", v)} />
        </TweakSection>
        <TweakSection title="内容">
          <TweakToggle label="显示每日签到" value={tweaks.showCheckin}
            onChange={v => setTweak("showCheckin", v)} />
        </TweakSection>
        <div style={{padding: "8px 14px 14px", color: "var(--fg-3)", fontSize: 11, fontFamily: "var(--font-mono)"}}>
          ⌘K 命令面板 · ⌘. 切专注模式
        </div>
      </TweaksPanel>
    </div>
  );
}

// ========== Titlebar ==========
function Titlebar({ view, setView, activeDoc, onPalette, focusMode, setFocusMode }) {
  return (
    <div className="titlebar">
      <div className="traffic"><span/><span/><span/></div>
      <div className="crumbs">
        <button onClick={() => setView("library")} style={{color:"inherit", cursor:"pointer"}}>学习库</button>
        {view === "reader" && (
          <>
            <span className="sep">›</span>
            <span style={{color:"var(--fg-2)"}}>{activeDoc.subject}</span>
            <span className="sep">›</span>
            <span className="now">{activeDoc.title}</span>
          </>
        )}
      </div>
      <div className="actions">
        <button className="t-btn kbd" onClick={onPalette}>
          <span style={{color:"var(--fg-2)"}}>{I.search}</span> 跳转或搜索 <kbd>⌘K</kbd>
        </button>
        <button className={`t-btn ${focusMode !== "off" ? "" : ""}`} title="专注模式 ⌘."
                onClick={() => setFocusMode(focusMode === "off" ? "sidebar-hidden" : "off")}
                style={focusMode !== "off" ? {background:"var(--accent-soft)", color:"var(--accent)"} : {}}>
          {I.focus} {focusMode === "off" ? "" : focusMode === "sidebar-hidden" ? "专注" : "全专注"}
        </button>
        <button className="t-btn">{I.cog}</button>
        <div style={{width: 28, height: 28, borderRadius: "50%", background: "var(--bg-3)", display:"grid", placeItems:"center", fontSize: 12, fontWeight: 600, color:"var(--fg-1)", marginLeft: 4}}>子</div>
      </div>
    </div>
  );
}

// ========== Sidebar ==========
function Sidebar({ activeDocId, view, onSelectDoc, onLibrary, onPalette, onUpload, onFlash }) {
  return (
    <div className="sidebar">
      <div className="brand">
        <div className="logo">G</div>
        <div className="name">
          Genote
          <small>生思笔记 · v0.1</small>
        </div>
      </div>
      <button className="sb-search" onClick={onPalette}>
        {I.search} 搜索…
        <span className="kbd-mini">⌘K</span>
      </button>
      <div className="sb-list">
        <button className={`sb-item ${view === "library" ? "active" : ""}`} onClick={onLibrary}>
          <span className="ico">{I.layers}</span> 学习库 <span className="count">6</span>
        </button>
        <button className="sb-item" onClick={onFlash}>
          <span className="ico">{I.card}</span> 闪卡 <span className="count" style={{color:"var(--accent)"}}>12</span>
        </button>
        <button className="sb-item">
          <span className="ico">{I.star}</span> 收藏
        </button>
        <button className="sb-item" onClick={onUpload}>
          <span className="ico">{I.plus}</span> 上传新文档
        </button>
      </div>

      <div className="sb-section">最近文档</div>
      <div className="sb-list">
        {DOCS.slice(0, 5).map(d => (
          <button key={d.id}
                  className={`sb-doc ${activeDocId === d.id && view === "reader" ? "active" : ""}`}
                  onClick={() => onSelectDoc(d.id)}>
            <div className={`doc-ico ${d.type}`}>{d.type === "pdf" ? "PDF" : d.type === "video" ? "VID" : "AUD"}</div>
            <div className="meta">
              <div className="title">{d.title}</div>
              <div className="sub">{d.subject} · {Math.round(d.progress*100)}%</div>
            </div>
          </button>
        ))}
      </div>

      <div className="streak">
        <div className="flame">{I.flame}</div>
        <div className="info">
          <b>4 天连胜</b>
          <span>距 7 天奖励 还差 3 天</span>
        </div>
      </div>
    </div>
  );
}

// ========== Status bar ==========
function Status({ view, activeDoc }) {
  return (
    <div className="status">
      <span className="dot" /> Qdrant · 已连接
      <span>·</span>
      <span>DeepSeek-V3</span>
      <span>·</span>
      <span>{view === "library" ? `${DOCS.length} 文档 · 3,012 段落已索引` : `${activeDoc.chunks} 段落 · ${activeDoc.sizeMB}MB`}</span>
      <span style={{marginLeft:"auto"}}>↳ 平均检索 312ms · ⌘K 跳转</span>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
