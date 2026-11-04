import type { GraphEdge, GraphNode } from "./types";

export type GraphPoint = { x: number; y: number };
export type GraphLayout = Record<string, GraphPoint>;

const WIDTH = 900;
const HEIGHT = 680;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 简易力导向布局（斥力 + 弹簧 + 轻微向心），带确定性随机种子：
 * 同一份快照 + 同一个 seed 一定得到同一张图，便于截图与回归。
 */
export function computeGraphLayout(nodes: GraphNode[], edges: GraphEdge[], seed = 7): GraphLayout {
  const rand = mulberry32(seed);
  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;
  const positions = new Map<string, { x: number; y: number; vx: number; vy: number }>();

  const directions = nodes.filter((n) => n.type === "direction");
  directions.forEach((node, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(directions.length, 1) - Math.PI / 2;
    positions.set(node.id, { x: cx + Math.cos(angle) * 210, y: cy + Math.sin(angle) * 170, vx: 0, vy: 0 });
  });

  const me = nodes.find((n) => n.type === "me");
  if (me) positions.set(me.id, { x: cx, y: cy, vx: 0, vy: 0 });

  const neighbours = new Map<string, string[]>();
  for (const edge of edges) {
    if (!neighbours.has(edge.source)) neighbours.set(edge.source, []);
    if (!neighbours.has(edge.target)) neighbours.set(edge.target, []);
    neighbours.get(edge.source)?.push(edge.target);
    neighbours.get(edge.target)?.push(edge.source);
  }

  for (const node of nodes) {
    if (positions.has(node.id)) continue;
    const anchorId = (neighbours.get(node.id) ?? []).find((id) => positions.has(id));
    const anchor = anchorId ? positions.get(anchorId) ?? { x: cx, y: cy } : { x: cx, y: cy };
    const distance = 50 + rand() * 90;
    const angle = rand() * Math.PI * 2;
    positions.set(node.id, {
      x: anchor.x + Math.cos(angle) * distance,
      y: anchor.y + Math.sin(angle) * distance,
      vx: 0,
      vy: 0
    });
  }

  const list = nodes.map((n) => ({ id: n.id, p: positions.get(n.id)! }));
  const iterations = 520;

  for (let iter = 0; iter < iterations; iter++) {
    const cool = 1 - iter / iterations;

    for (let i = 0; i < list.length; i++) {
      const a = list[i].p;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j].p;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        const dist2 = Math.max(dx * dx + dy * dy, 25);
        const force = (2200 / dist2) * cool;
        const dist = Math.sqrt(dist2);
        dx /= dist;
        dy /= dist;
        a.vx += dx * force;
        a.vy += dy * force;
        b.vx -= dx * force;
        b.vy -= dy * force;
      }
    }

    for (const edge of edges) {
      const a = positions.get(edge.source);
      const b = positions.get(edge.target);
      if (!a || !b) continue;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const force = (dist - 78) * 0.018 * cool;
      dx /= dist;
      dy /= dist;
      a.vx += dx * force;
      a.vy += dy * force;
      b.vx -= dx * force;
      b.vy -= dy * force;
    }

    for (const entry of list) {
      const p = entry.p;
      p.vx += (cx - p.x) * 0.004 * cool;
      p.vy += (cy - p.y) * 0.004 * cool;
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.82;
      p.vy *= 0.82;
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const entry of list) {
    minX = Math.min(minX, entry.p.x);
    maxX = Math.max(maxX, entry.p.x);
    minY = Math.min(minY, entry.p.y);
    maxY = Math.max(maxY, entry.p.y);
  }
  // 横向/纵向分别铺满画布：节点位置可以非等比拉伸，但圆点半径是独立用户单位，
  // 因此圆仍然是圆，只是整体占满画布、不留下大片空白。
  const pad = 46;
  const scaleX = (WIDTH - pad * 2) / Math.max(maxX - minX, 1);
  const scaleY = (HEIGHT - pad * 2) / Math.max(maxY - minY, 1);

  const layout: GraphLayout = {};
  for (const entry of list) {
    layout[entry.id] = {
      x: Math.round((pad + (entry.p.x - minX) * scaleX) * 10) / 10,
      y: Math.round((pad + (entry.p.y - minY) * scaleY) * 10) / 10
    };
  }
  return layout;
}
