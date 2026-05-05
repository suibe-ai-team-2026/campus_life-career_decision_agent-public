/* global React */
const { useState, useEffect, useRef, useMemo, useCallback } = React;

// ---------- Icons (inline SVG, stroke=1.5) ----------
const Icon = ({ d, size = 16, fill }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill || "none"} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
  </svg>
);
const I = {
  search: <Icon d="M21 21l-4.3-4.3M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z" />,
  plus: <Icon d="M12 5v14M5 12h14" />,
  upload: <Icon d={["M12 16V4", "M7 9l5-5 5 5", "M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"]} />,
  doc: <Icon d={["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z", "M14 2v6h6"]} />,
  video: <Icon d={["M2 6a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z", "M22 8l-5 4 5 4z"]} />,
  audio: <Icon d={["M9 18V5l12-2v13", "M6 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3z", "M21 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3z"]} />,
  star: <Icon d="M12 2l3 7 7 .5-5.5 4.5L18 21l-6-3.5L6 21l1.5-7L2 9.5 9 9z" />,
  flame: <Icon d="M12 2c1 4 5 5 5 10a5 5 0 1 1-10 0 6 6 0 0 1 2-4c0 3 3 3 3-6z" />,
  card: <Icon d={["M3 6h18v12H3z", "M3 10h18"]} />,
  cog: <Icon d={["M12 8a4 4 0 1 0 4 4 4 4 0 0 0-4-4z", "M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"]} />,
  focus: <Icon d={["M3 7V5a2 2 0 0 1 2-2h2", "M21 7V5a2 2 0 0 0-2-2h-2", "M3 17v2a2 2 0 0 0 2 2h2", "M21 17v2a2 2 0 0 1-2 2h-2"]} />,
  zoomIn: <Icon d={["M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z", "M21 21l-4.3-4.3", "M11 8v6", "M8 11h6"]} />,
  zoomOut: <Icon d={["M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z", "M21 21l-4.3-4.3", "M8 11h6"]} />,
  page: <Icon d={["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z", "M8 13h8", "M8 17h6"]} />,
  arrowLeft: <Icon d="M15 18l-6-6 6-6" />,
  arrowRight: <Icon d="M9 18l6-6-6-6" />,
  send: <Icon d={["M22 2 11 13", "M22 2l-7 20-4-9-9-4z"]} />,
  send2: <Icon d="M5 12l14-7-3 8 3 8z" />,
  paperclip: <Icon d="M21.4 11l-9.2 9.2a6 6 0 0 1-8.5-8.5L13 2.4a4 4 0 0 1 5.7 5.7L9.4 17.5a2 2 0 0 1-2.8-2.8l8.5-8.5" />,
  bolt: <Icon d="M13 2 3 14h8L11 22l10-12h-8z" />,
  x: <Icon d="M18 6L6 18M6 6l12 12" />,
  play: <Icon d="M5 3l14 9-14 9z" fill="currentColor" />,
  pause: <Icon d={["M6 4h4v16H6z", "M14 4h4v16h-4z"]} fill="currentColor" />,
  skip: <Icon d="M5 4l9 8-9 8zM18 4v16" />,
  rewind: <Icon d={["M11 4 3 12l8 8", "M21 4 13 12l8 8"]} />,
  vol: <Icon d={["M11 5 6 9H2v6h4l5 4z", "M19 12a7 7 0 0 0-3-5.7", "M16 8.6a3.5 3.5 0 0 1 0 6.8"]} />,
  fs: <Icon d={["M3 9V3h6", "M21 9V3h-6", "M3 15v6h6", "M21 15v6h-6"]} />,
  pin: <Icon d="M12 17v5M9 3h6l-1 6 4 4H6l4-4z" />,
  back: <Icon d="M19 12H5M12 19l-7-7 7-7" />,
  list: <Icon d={["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"]} />,
  msg: <Icon d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z" />,
  pen: <Icon d={["M12 20h9", "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"]} />,
  layers: <Icon d={["M12 2 2 7l10 5 10-5z", "M2 17l10 5 10-5", "M2 12l10 5 10-5"]} />,
  sparkle: <Icon d={["M12 2v6", "M12 16v6", "M2 12h6", "M16 12h6", "M5 5l4 4", "M15 15l4 4", "M5 19l4-4", "M15 9l4-4"]} />,
  chevR: <Icon d="M9 18l6-6-6-6" />,
  trash: <Icon d={["M3 6h18", "M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6", "M10 11v6", "M14 11v6"]} />,
  highlight: <Icon d={["M9 11l-6 6v4h4l6-6", "M22 6.5L17.5 2 9 10.5 13.5 15z"]} />,
  copy: <Icon d={["M9 9h13v13H9z", "M5 15H3a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2"]} />,
  link: <Icon d={["M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1", "M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"]} />,
};

// Format seconds → mm:ss
const fmt = (s) => {
  s = Math.max(0, Math.floor(s));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2,"0")}:${String(r).padStart(2,"0")}`;
};

window.Icon = Icon;
window.I = I;
window.fmt = fmt;
