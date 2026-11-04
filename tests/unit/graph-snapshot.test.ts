import { describe, expect, it } from "vitest";
import { graphSnapshot } from "@/lib/graph";
import { buildAdjacency, buildDegree } from "@/lib/graph/utils";
import { computeGraphLayout } from "@/lib/graph/layout";
import { GRAPH_STATUS_LABEL, GRAPH_TYPE_META } from "@/lib/graph/palette";

const snapshot = graphSnapshot;

describe("knowledge graph snapshot", () => {
  it("is versioned and carries profile + boundaries", () => {
    expect(snapshot.version).toMatch(/^graph-\d{4}-\d{2}-\d{2}\.\d+$/);
    expect(snapshot.profile.label.length).toBeGreaterThan(0);
    expect(snapshot.boundaries.length).toBeGreaterThan(0);
    expect(snapshot.nodes.length).toBeGreaterThan(20);
    expect(snapshot.edges.length).toBeGreaterThan(30);
    expect(snapshot.citations.length).toBeGreaterThan(5);
  });

  it("has unique node ids and only known node types", () => {
    const ids = new Set<string>();
    for (const node of snapshot.nodes) {
      expect(ids.has(node.id)).toBe(false);
      ids.add(node.id);
      expect(GRAPH_TYPE_META[node.type]).toBeTruthy();
      expect(GRAPH_STATUS_LABEL[node.status]).toBeTruthy();
    }
  });

  it("only links existing nodes, without self loops or duplicate edges", () => {
    const ids = new Set(snapshot.nodes.map((node) => node.id));
    const seen = new Set<string>();
    for (const edge of snapshot.edges) {
      expect(ids.has(edge.source)).toBe(true);
      expect(ids.has(edge.target)).toBe(true);
      expect(edge.source).not.toBe(edge.target);
      const key = [edge.source, edge.target].sort().join("→");
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("gives every node a Wiki page with claims and where-to-check entries", () => {
    const citationIds = new Set(snapshot.citations.map((citation) => citation.id));
    for (const node of snapshot.nodes) {
      expect(node.wiki.sections.length).toBeGreaterThan(0);
      expect(node.wiki.guides.length).toBeGreaterThan(0);
      const paragraphs = node.wiki.sections.flatMap((section) => section.paragraphs);
      expect(paragraphs.length).toBeGreaterThan(0);
      for (const paragraph of paragraphs) {
        expect(["evidence", "inference", "gap"]).toContain(paragraph.tag);
        for (const citationId of paragraph.citations) {
          expect(citationIds.has(citationId)).toBe(true);
        }
      }
    }
  });

  it("marks data-gap nodes explicitly", () => {
    const gaps = snapshot.nodes.filter((node) => node.type === "gap");
    expect(gaps.length).toBeGreaterThan(0);
    for (const gap of gaps) {
      expect(gap.status).toBe("pending");
      expect(gap.wiki.guides.length).toBeGreaterThan(0);
      const hasGapClaim = gap.wiki.sections.some((section) =>
        section.paragraphs.some((paragraph) => paragraph.tag === "gap")
      );
      expect(hasGapClaim).toBe(true);
    }
  });

  it("derives adjacency and degree from edges (size semantics)", () => {
    const adjacency = buildAdjacency(snapshot.edges);
    const degree = buildDegree(snapshot.edges);
    for (const node of snapshot.nodes) {
      expect(degree.get(node.id) ?? 0).toBeGreaterThan(0);
      expect((adjacency.get(node.id) ?? []).length).toBe(degree.get(node.id) ?? 0);
    }
    for (const edge of snapshot.edges) {
      expect(adjacency.get(edge.source)).toContain(edge.target);
      expect(adjacency.get(edge.target)).toContain(edge.source);
    }
  });

  it("lays out deterministically inside the viewport", () => {
    const first = computeGraphLayout(snapshot.nodes, snapshot.edges, 7);
    const second = computeGraphLayout(snapshot.nodes, snapshot.edges, 7);
    expect(first).toEqual(second);
    for (const point of Object.values(first)) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(900);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(680);
    }
  });

  it("uses the Morandi palette variables for every node type", () => {
    for (const meta of Object.values(GRAPH_TYPE_META)) {
      expect(meta.colorVar).toMatch(/^var\(--graph-[a-z]+\)$/);
      expect(meta.label.length).toBeGreaterThan(0);
    }
  });
});
