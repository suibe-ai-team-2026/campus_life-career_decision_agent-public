/* global React, I, Icon, fmt, OUTLINE, TRANSCRIPT, PDF_CHAT, VIDEO_CHAT, NOTES_INIT, DOCS */
const { useState, useEffect, useRef, useCallback } = React;

// ========== Library / Dashboard ==========
function Library({ onOpen, onUpload, onStartFlash, onCheckin, checkedIn }) {
  const recents = DOCS.slice(0, 5);
  const week = ["一","二","三","四","五","六","日"];
  // mock check-in: first 4 done, 5th today
  const days = [
    { day: "一", done: true, label: "29" },
    { day: "二", done: true, label: "30" },
    { day: "三", done: true, label: "1" },
    { day: "四", done: true, label: "2" },
    { day: "五", today: true, done: checkedIn, label: "3" },
    { day: "六", label: "4" },
    { day: "日", label: "5" },
  ];

  return (
    <div className="lib">
      <h1>下午好，<span style={{color: "var(--accent)"}}>子衿</span>。</h1>
      <p className="lead">距离 <em>2026 考研初试</em> 还剩 <em>238</em> 天 · 今天计划 <em>3.5h</em></p>

      <div className="lib-grid">
        <div>
          <button className="uploader" onClick={onUpload}>
            <div className="big">上传 PDF / 长视频 / 录音</div>
            <div className="small">拖拽到此处，或点击选择文件 · 单文件 ≤ 200MB</div>
            <div className="types">
              <span>PDF</span><span>DOCX</span><span>MP4</span><span>MOV</span><span>MP3</span><span>WAV</span><span>JPG</span>
            </div>
          </button>

          <div className="lib-card">
            <h3>最近打开 <span className="pill">{recents.length}</span></h3>
            <div className="recents">
              {recents.map(d => (
                <div key={d.id} className="recent" onClick={() => onOpen(d.id)}>
                  <div className={`thumb ${d.type}`}>{d.type.toUpperCase()}</div>
                  <div className="meta">
                    <div className="ttl">{d.title}</div>
                    <div className="det">
                      {d.subject} · {d.type === "pdf" ? `${d.pages} 页` : fmt(d.durationSec)} · {d.lastOpened}
                      {!d.indexed && <span style={{color: "var(--warn)", marginLeft: 8}}>● 索引中…</span>}
                    </div>
                  </div>
                  <div className="progress"><i style={{width: `${d.progress*100}%`}} /></div>
                  <div className="pct">{Math.round(d.progress*100)}%</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div>
          <div className="checkin">
            <div className="row1">
              <span style={{color: "var(--accent)"}}>{I.flame}</span>
              <h4>已连续学习 <b>4</b> 天</h4>
              <span className="day" style={{marginLeft: "auto"}}>+2 经验 / 日</span>
            </div>
            <div className="grid">
              {days.map((d,i) => (
                <div key={i} className={`day-dot ${d.done ? "done" : ""} ${d.today && !d.done ? "today" : ""}`}>
                  {d.label}
                </div>
              ))}
            </div>
            <button className={`cta ${checkedIn ? "done" : ""}`} disabled={checkedIn} onClick={onCheckin}>
              {checkedIn ? "✓ 今日已签到" : "今日签到 +2 经验"}
            </button>
          </div>

          <div className="lib-card flashcards-card">
            <h3>闪卡复习 <span className="pill">12 待复习</span></h3>
            <div className="stats">
              <div className="stat due"><b>12</b><span>待复习</span></div>
              <div className="stat"><b>48</b><span>学习中</span></div>
              <div className="stat"><b>134</b><span>已掌握</span></div>
            </div>
            <button className="btn-secondary" onClick={onStartFlash}>开始今日复习 →</button>
          </div>

          <div className="lib-card" style={{marginTop: 16}}>
            <h3>本周指标</h3>
            <div style={{display: "grid", gap: 10}}>
              <Metric label="学习时长" value="14h 22m" hint="+18% 较上周" />
              <Metric label="新增笔记" value="38 段" hint="3 篇文档" />
              <Metric label="AI 提问" value="124 次" hint="平均 3.7s 响应" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({label, value, hint}) {
  return (
    <div style={{display: "flex", alignItems: "baseline", justifyContent: "space-between", borderBottom: "1px dashed var(--line-soft)", paddingBottom: 8}}>
      <div>
        <div style={{fontSize: 12, color: "var(--fg-2)"}}>{label}</div>
        <div style={{fontSize: 11, color: "var(--fg-3)", fontFamily: "var(--font-mono)"}}>{hint}</div>
      </div>
      <div style={{fontFamily: "var(--font-read)", fontSize: 20, fontWeight: 500}}>{value}</div>
    </div>
  );
}

window.Library = Library;
