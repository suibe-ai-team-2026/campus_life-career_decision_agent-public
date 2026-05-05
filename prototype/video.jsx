/* global React, I, Icon, fmt, TRANSCRIPT, VIDEO_CHAT, ChatPanel, Splitter, RightTabs */
const { useState: useStateV, useEffect: useEffectV, useRef: useRefV } = React;

// ========== Video Reader ==========
function VideoReader({ doc, focusMode, splitPx, setSplitPx, rightTab, setRightTab }) {
  const [t, setT] = useStateV(412); // start near the "trace=sum of eigenvalues" bit
  const [playing, setPlaying] = useStateV(false);
  const [speed, setSpeed] = useStateV(1.5);
  const dur = doc.durationSec;

  useEffectV(() => {
    if (!playing) return;
    const id = setInterval(() => setT(p => Math.min(dur, p + speed)), 1000);
    return () => clearInterval(id);
  }, [playing, speed, dur]);

  // Active transcript segment
  const activeIdx = (() => {
    let i = 0;
    for (let j = 0; j < TRANSCRIPT.length; j++) if (TRANSCRIPT[j].t <= t) i = j;
    return i;
  })();

  const jumpTo = (sec) => { setT(sec); setPlaying(true); };

  return (
    <div className={`reader ${focusMode === "right-only" ? "focus-hide-right" : ""}`}
         style={{"--split-r": `${splitPx}px`}}>
      <div className="doc-pane">
        <div className="doc-toolbar">
          <button className="ico-btn" title="目录">{I.list}</button>
          <button className="ico-btn" title="书签">{I.pin}</button>
          <div className="spacer" />
          <span className="doc-title"><b>{doc.title}</b> · 章节 3/8</span>
        </div>

        <div className="video-stage">
          <div className="video-frame">
            <div className="center-info">
              <div className="ttl">第 3 章 · 特征值与对角化</div>
              <div className="sub">{fmt(t)} / {fmt(dur)} · {speed}× · 1080p</div>
            </div>
            <button className="play-btn" onClick={() => setPlaying(p => !p)}>
              {playing ? <Icon d={["M6 4h4v16H6z","M14 4h4v16h-4z"]} size={28} fill="currentColor" /> : <Icon d="M5 3l14 9-14 9z" size={28} fill="currentColor" />}
            </button>
          </div>

          <Scrubber t={t} dur={dur} onSeek={setT} markers={TRANSCRIPT.map(s => s.t)} />

          <div className="transcript">
            {TRANSCRIPT.map((s, i) => (
              <div key={i}
                   className={`seg ${i === activeIdx ? "active" : ""} ${i < activeIdx ? "played" : ""}`}
                   onClick={() => jumpTo(s.t)}>
                <span className="ts">{fmt(s.t)}</span>
                <span className="body">{s.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <Splitter onDrag={(dx) => setSplitPx(p => Math.max(360, Math.min(820, p - dx)))} />

      <div className="right-pane">
        <RightTabs tab={rightTab} setTab={setRightTab} />
        {rightTab === "chat" && <ChatPanel initialChat={VIDEO_CHAT} contextLabel={`${doc.title} · ${fmt(t)}`} variant="video" onJumpVideo={jumpTo} />}
        {rightTab === "notes" && React.createElement(window.NotesPanel)}
        {rightTab === "outline" && (
          <div className="outline">
            {TRANSCRIPT.map((s, i) => (
              <button key={i} className="outline-item l2" onClick={() => jumpTo(s.t)}>
                <span style={{flex:1, textAlign:"left"}}>{s.text.slice(0, 24)}…</span>
                <span className="pg">{fmt(s.t)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Scrubber({ t, dur, onSeek, markers }) {
  const ref = useRefV(null);
  const onClick = (e) => {
    const r = ref.current.getBoundingClientRect();
    const p = (e.clientX - r.left) / r.width;
    onSeek(Math.max(0, Math.min(dur, p * dur)));
  };
  const pct = (t / dur) * 100;
  return (
    <div className="video-controls">
      <div className="scrub" ref={ref} onClick={onClick}>
        <div className="fill" style={{width: `${pct}%`}} />
        <div className="head" style={{left: `${pct}%`}} />
        {markers.map((m, i) => (
          <div key={i} className="marker" style={{left: `${(m/dur)*100}%`}} title={fmt(m)} />
        ))}
      </div>
      <div className="row">
        <button className="ico-btn" title="-15s" onClick={() => onSeek(Math.max(0, t-15))}>{I.rewind}</button>
        <button className="ico-btn" title="+15s" onClick={() => onSeek(Math.min(dur, t+15))}>{I.skip}</button>
        <span className="time">{fmt(t)}</span>
        <span className="duration">/ {fmt(dur)}</span>
        <div className="right">
          <span className="speed">{1.5}× ▾</span>
          <button className="ico-btn">{I.vol}</button>
          <button className="ico-btn">{I.fs}</button>
        </div>
      </div>
    </div>
  );
}

window.VideoReader = VideoReader;
