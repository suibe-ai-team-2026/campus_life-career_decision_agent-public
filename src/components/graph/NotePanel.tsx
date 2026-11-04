"use client";

import type { GraphCitation, GraphNode } from "@/lib/graph/types";
import { GRAPH_CLAIM_LABEL, GRAPH_STATUS_LABEL, GRAPH_TYPE_META } from "@/lib/graph/palette";

function statusClass(node: GraphNode): string {
  if (node.type === "gap") return "is-gap";
  if (node.status === "verified") return "is-ok";
  if (node.status === "partial" || node.status === "official_lead" || node.status === "external_reference") {
    return "is-partial";
  }
  return "is-gap";
}

function statusText(node: GraphNode): string {
  if (node.type === "gap") return "待查";
  return GRAPH_STATUS_LABEL[node.status];
}

export function NotePanel({
  node,
  citations,
  adjacency,
  nodeById,
  degree,
  version,
  boundaries,
  onSelect
}: {
  node: GraphNode;
  citations: GraphCitation[];
  adjacency: Map<string, string[]>;
  nodeById: ReadonlyMap<string, GraphNode>;
  degree: number;
  version: string;
  boundaries: string[];
  onSelect: (id: string) => void;
}) {
  const citationById = new Map(citations.map((citation) => [citation.id, citation]));
  const citedIds = new Set<string>();
  for (const section of node.wiki.sections) {
    for (const paragraph of section.paragraphs) {
      for (const id of paragraph.citations) {
        if (citationById.has(id)) citedIds.add(id);
      }
    }
  }
  const neighbours = (adjacency.get(node.id) ?? [])
    .map((id) => nodeById.get(id))
    .filter((item): item is GraphNode => Boolean(item));

  return (
    <aside className="graph-note" aria-label={`${node.title} 的 Wiki 页`}>
      <div className="note-head">
        <span className="note-type">{GRAPH_TYPE_META[node.type].label}</span>
        <span className={`note-status ${statusClass(node)}`}>{statusText(node)}</span>
        <span className="note-degree">连接 {degree} 个节点</span>
      </div>
      <h2 className="note-title">{node.title}</h2>
      <p className="note-sub">{node.sub}</p>
      <p className="note-why">为什么在图里：{node.why}</p>
      <div className="note-meta">
        <span>
          引用 <b>{citedIds.size}</b> 条
        </span>
        <span>
          查证入口 <b>{node.wiki.guides.length}</b> 个
        </span>
        <span>
          快照 <b>{version}</b>
        </span>
      </div>

      {node.wiki.sections.map((section) => (
        <section className="note-section" key={section.heading}>
          <h3>{section.heading}</h3>
          {section.paragraphs.map((paragraph, index) => (
            <p className="note-para" key={`${section.heading}-${index}`}>
              <span className={`note-tag is-${paragraph.tag}`}>{GRAPH_CLAIM_LABEL[paragraph.tag]}</span>
              {paragraph.text}
              {paragraph.citations.map((id) => {
                const citation = citationById.get(id);
                if (!citation) return null;
                return citation.url ? (
                  <sup key={id}>
                    <a
                      className="note-cite"
                      href={citation.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`${citation.title} · ${citation.locator}`}
                    >
                      [{citation.no}]
                    </a>
                  </sup>
                ) : (
                  <sup key={id} className="note-cite">
                    [{citation.no}]
                  </sup>
                );
              })}
            </p>
          ))}
        </section>
      ))}

      <section className="note-section">
        <h3>去哪查</h3>
        {node.wiki.guides.map((guide) => (
          <div className="note-guide" key={`${guide.label}-${guide.url}`}>
            <a href={guide.url} target="_blank" rel="noopener noreferrer">
              {guide.label} ↗
            </a>
            <p className="guide-look">查什么：{guide.look}</p>
            <div className="guide-meta">
              <span>更新：{guide.cadence}</span>
              <span>上次核验：{guide.last_checked}</span>
            </div>
          </div>
        ))}
      </section>

      {neighbours.length > 0 ? (
        <p className="note-neighbors">
          相邻节点：
          {neighbours.map((neighbour, index) => (
            <span key={neighbour.id}>
              <button type="button" className="note-neighbor" onClick={() => onSelect(neighbour.id)}>
                {neighbour.title}
              </button>
              {index < neighbours.length - 1 ? " · " : ""}
            </span>
          ))}
        </p>
      ) : null}

      <div className="note-boundary">
        {boundaries.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </aside>
  );
}
