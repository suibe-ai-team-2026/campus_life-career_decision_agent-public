"use client";

import { useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { GraphNode, GraphSnapshot } from "@/lib/graph/types";
import { GRAPH_TYPE_META } from "@/lib/graph/palette";
import { buildAdjacency, buildDegree } from "@/lib/graph/utils";
import { computeGraphLayout, type GraphPoint } from "@/lib/graph/layout";
import { NotePanel } from "./NotePanel";
import { useLocalProgress, readExplorePrefs } from "@/lib/local-progress/store";
import { withLocalProfile } from "@/lib/graph/local-profile";

const WIDTH = 900;
const HEIGHT = 680;

const TYPE_ORDER: GraphNode["type"][] = [
  "direction",
  "program",
  "course",
  "competition",
  "job",
  "resource",
  "gap",
  "me"
];

function nodeRadius(node: GraphNode, degree: Map<string, number>, maxDegree: number): number {
  if (node.type === "me") return 11;
  if (node.type === "gap") return 5;
  const ratio = Math.sqrt(Math.max(degree.get(node.id) ?? 0, 1) / Math.max(maxDegree, 1));
  return Math.min(13, 4.5 + ratio * 9.5);
}

function shortLabel(title: string): string {
  return title.length > 12 ? `${title.slice(0, 11)}…` : title;
}

type LabelCandidate = {
  id: string;
  rect: { x: number; y: number; w: number; h: number };
  priority: number;
};

export function GraphExplorer({ snapshot }: { snapshot: GraphSnapshot }) {
  const { progress, hydrated } = useLocalProgress();
  const activeSnapshot = useMemo(
    () =>
      withLocalProfile(snapshot, progress, hydrated, {
        pathwayPrimary: hydrated ? readExplorePrefs().pathway.primary : null
      }),
    [snapshot, progress, hydrated]
  );
  return <GraphExplorerView snapshot={activeSnapshot} />;
}

function GraphExplorerView({ snapshot }: { snapshot: GraphSnapshot }) {
  const nodeById = useMemo(() => new Map(snapshot.nodes.map((node) => [node.id, node])), [snapshot]);
  const adjacency = useMemo(() => buildAdjacency(snapshot.edges), [snapshot]);
  const degree = useMemo(() => buildDegree(snapshot.edges), [snapshot]);
  const maxDegree = useMemo(() => Math.max(1, ...snapshot.nodes.map((node) => degree.get(node.id) ?? 0)), [snapshot, degree]);

  const [seed, setSeed] = useState(7);
  const baseLayout = useMemo(() => computeGraphLayout(snapshot.nodes, snapshot.edges, seed), [snapshot, seed]);
  const [dragged, setDragged] = useState<Record<string, GraphPoint>>({});
  const positions = useMemo<Record<string, GraphPoint>>(() => {
    if (Object.keys(dragged).length === 0) return baseLayout;
    return { ...baseLayout, ...dragged };
  }, [baseLayout, dragged]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [onlyVerified, setOnlyVerified] = useState(false);
  const [showGaps, setShowGaps] = useState(true);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const pressRef = useRef<{ id: string; start: GraphPoint; moved: boolean } | null>(null);

  const visibleIds = useMemo(() => {
    const ids = new Set<string>();
    for (const node of snapshot.nodes) {
      if (node.type === "gap" && !showGaps) continue;
      if (
        onlyVerified &&
        node.status !== "verified" &&
        node.status !== "partial" &&
        node.status !== "official_lead"
      ) {
        continue;
      }
      ids.add(node.id);
    }
    return ids;
  }, [snapshot, showGaps, onlyVerified]);

  const focusId = hoverId ?? selectedId;
  const neighbourIds = useMemo(() => {
    if (!focusId) return new Set<string>();
    return new Set([focusId, ...(adjacency.get(focusId) ?? [])]);
  }, [focusId, adjacency]);

  const labels = useMemo(() => {
    const visible = new Set<string>();
    const rects: LabelCandidate["rect"][] = [];
    const candidates: LabelCandidate[] = [];
    for (const node of snapshot.nodes) {
      if (!visibleIds.has(node.id)) continue;
      const point = positions[node.id];
      if (!point) continue;
      // 叶子节点默认不显示标签（悬停/选中时再出现），避免 40+ 个标签互相压字
      const important =
        node.type === "direction" ||
        node.type === "program" ||
        node.type === "me" ||
        node.type === "gap" ||
        (degree.get(node.id) ?? 0) >= 2;
      if (!important && node.id !== focusId) continue;
      const label = shortLabel(node.title);
      const radius = nodeRadius(node, degree, maxDegree);
      const right = point.x >= WIDTH / 2;
      const lx = point.x + (right ? radius + 5 : -(radius + 5));
      const width = label.length * 6.2 + 4;
      candidates.push({
        id: node.id,
        rect: { x: right ? lx : lx - width, y: point.y - 8, w: width, h: 13 },
        priority: (node.id === focusId ? 1000 : 0) + radius
      });
    }
    candidates.sort((a, b) => b.priority - a.priority);
    for (const candidate of candidates) {
      const overlaps = rects.some(
        (rect) =>
          !(
            candidate.rect.x + candidate.rect.w < rect.x ||
            candidate.rect.x > rect.x + rect.w ||
            candidate.rect.y + candidate.rect.h < rect.y ||
            candidate.rect.y > rect.y + rect.h
          )
      );
      if (!overlaps || candidate.id === focusId) {
        rects.push(candidate.rect);
        visible.add(candidate.id);
      }
    }
    return visible;
  }, [snapshot, visibleIds, positions, focusId, degree, maxDegree]);

  const presentTypes = useMemo(() => {
    const present = new Set(snapshot.nodes.map((node) => node.type));
    return TYPE_ORDER.filter((type) => type !== "gap" && present.has(type));
  }, [snapshot]);

  function toPoint(clientX: number, clientY: number): GraphPoint {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const matrix = svg.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const transformed = point.matrixTransform(matrix.inverse());
    return { x: Math.round(transformed.x * 10) / 10, y: Math.round(transformed.y * 10) / 10 };
  }

  function handlePointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    const target = (event.target as Element).closest("[data-node-id]");
    if (!target) {
      setSelectedId(null);
      setHoverId(null);
      return;
    }
    const id = target.getAttribute("data-node-id");
    if (!id || !visibleIds.has(id)) return;
    pressRef.current = { id, start: toPoint(event.clientX, event.clientY), moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const press = pressRef.current;
    if (press) {
      const point = toPoint(event.clientX, event.clientY);
      const distance = Math.hypot(point.x - press.start.x, point.y - press.start.y);
      if (!press.moved && distance < 4) return;
      press.moved = true;
      setDragged((previous) => ({ ...previous, [press.id]: point }));
      return;
    }
    const target = (event.target as Element).closest("[data-node-id]");
    const id = target?.getAttribute("data-node-id") ?? null;
    setHoverId((previous) => (previous === id ? previous : id));
  }

  function handlePointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    const press = pressRef.current;
    pressRef.current = null;
    if (press && !press.moved) setSelectedId(press.id);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // setPointerCapture 可能已被浏览器释放，忽略即可
    }
  }

  const profileNode = snapshot.nodes.find((node) => node.type === "me") ?? snapshot.nodes[0];
  const selectedNode = selectedId ? nodeById.get(selectedId) ?? null : null;
  const panelNode = selectedNode ?? profileNode;
  const lowerQuery = query.trim().toLowerCase();

  return (
    <div className="graph-page">
      <header className="graph-head">
        <div>
          <h1>知识图谱</h1>
          <p>
            像 Obsidian 一样浏览生涯知识：颜色 = 节点类型，大小 = 连接度；点击节点在右侧读 Wiki 页。
            数据来自本校培养方案、竞赛清单、就业报告与招聘快照，每个节点都能回到来源入口。
          </p>
        </div>
        <span className="graph-version">{snapshot.version}</span>
      </header>

      <div className="graph-toolbar" role="toolbar" aria-label="图谱工具栏">
        <label className="graph-search">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索节点…"
            aria-label="搜索图谱节点"
          />
        </label>
        <label className="graph-chip">
          <input type="checkbox" checked={onlyVerified} onChange={(event) => setOnlyVerified(event.target.checked)} />
          只看官方来源
        </label>
        <label className="graph-chip">
          <input type="checkbox" checked={showGaps} onChange={(event) => setShowGaps(event.target.checked)} />
          显示核对入口
        </label>
        <button
          type="button"
          className="graph-relayout"
          onClick={() => {
            setDragged({});
            setSeed((previous) => previous + 1);
          }}
        >
          重新布局
        </button>
      </div>

      <div className="graph-layout">
        <div className="graph-canvas">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label="生涯知识图谱；颜色表示节点类型，大小表示连接度"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={() => setHoverId(null)}
          >
            <g aria-hidden="true">
              {snapshot.edges.map((edge, index) => {
                if (!visibleIds.has(edge.source) || !visibleIds.has(edge.target)) return null;
                const from = positions[edge.source];
                const to = positions[edge.target];
                if (!from || !to) return null;
                const highlighted = Boolean(focusId) && (edge.source === focusId || edge.target === focusId);
                const dimmed = Boolean(focusId) && !highlighted;
                const queryDimmed = Boolean(lowerQuery) && !highlighted;
                return (
                  <line
                    key={`${edge.source}-${edge.target}-${index}`}
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke={highlighted ? "var(--accent)" : "var(--line)"}
                    strokeWidth={highlighted ? 1.3 : 1}
                    opacity={dimmed ? 0.08 : queryDimmed ? 0.16 : 0.55}
                  />
                );
              })}
            </g>

            {snapshot.nodes.map((node) => {
              if (!visibleIds.has(node.id)) return null;
              const point = positions[node.id];
              if (!point) return null;
              const radius = nodeRadius(node, degree, maxDegree);
              const selected = selectedId === node.id;
              const isNeighbour = neighbourIds.has(node.id);
              const matches = !lowerQuery || node.title.toLowerCase().includes(lowerQuery);
              const opacity = !matches && node.type !== "me" ? 0.16 : focusId && !isNeighbour ? 0.25 : 1;
              const right = point.x >= WIDTH / 2;
              const labelX = point.x + (right ? radius + 5 : -(radius + 5));
              const label = shortLabel(node.title);
              return (
                <g
                  key={node.id}
                  data-node-id={node.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${node.title}（${GRAPH_TYPE_META[node.type].label}）`}
                  style={{ cursor: "pointer", outline: "none" }}
                  opacity={opacity}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedId(node.id);
                    }
                  }}
                >
                  <title>{node.title}</title>
                  {node.type === "gap" ? (
                    <circle
                      cx={point.x}
                      cy={point.y}
                      r={radius}
                      fill="transparent"
                      stroke="var(--graph-gap)"
                      strokeWidth={1.4}
                      strokeDasharray="3 3"
                    />
                  ) : (
                    <>
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r={radius}
                        fill={GRAPH_TYPE_META[node.type].colorVar}
                        stroke="var(--bg-1)"
                        strokeWidth={1.2}
                      />
                      {selected ? (
                        <circle
                          cx={point.x}
                          cy={point.y}
                          r={radius + 3.5}
                          fill="none"
                          stroke="var(--accent)"
                          strokeWidth={1.2}
                        />
                      ) : null}
                    </>
                  )}
                  {labels.has(node.id) ? (
                    <text
                      x={labelX}
                      y={point.y + 3.5}
                      textAnchor={right ? "start" : "end"}
                      fontSize={10}
                      fill={selected ? "var(--accent)" : "var(--fg-2)"}
                      pointerEvents="none"
                    >
                      {label}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
          <p className="graph-canvas-hint">拖拽节点调整位置 · 点击空白取消选中 · 颜色 = 类型，大小 = 连接度</p>
        </div>

        <NotePanel
          node={panelNode}
          citations={snapshot.citations}
          adjacency={adjacency}
          nodeById={nodeById}
          degree={degree.get(panelNode.id) ?? 0}
          version={snapshot.version}
          boundaries={snapshot.boundaries}
          onSelect={(id) => setSelectedId(id)}
        />
      </div>

      <div className="graph-legend">
        {presentTypes.map((type) => (
          <span className="legend-item" key={type}>
            <span className="swatch" style={{ background: GRAPH_TYPE_META[type].colorVar }} aria-hidden="true" />
            {GRAPH_TYPE_META[type].label}
          </span>
        ))}
        <span className="legend-item">
          <span className="swatch is-gap" aria-hidden="true" />
          核对入口（虚线）
        </span>
        <span className="legend-item size-demo" aria-hidden="true">
          <i className="small" />
          <i className="large" />
        </span>
        <span>节点大小 = 连接度（与它相连的知识条数）</span>
      </div>
    </div>
  );
}
