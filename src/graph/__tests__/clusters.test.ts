import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DependencyClusterAnalyzer } from "../clusters.js";
import { GraphStorage } from "../storage.js";
import type { GraphEdge } from "../types.js";

vi.mock("../../logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
}));

function makeEdge(
  sourceFile: string,
  targetFile: string,
  sourceId?: string,
  targetId?: string,
): GraphEdge {
  return {
    sourceId: sourceId ?? `src_${Math.random().toString(36).slice(2, 8)}`,
    targetId: targetId ?? `tgt_${Math.random().toString(36).slice(2, 8)}`,
    relationshipType: "calls",
    sourceFile,
    targetFile,
  };
}

describe("DependencyClusterAnalyzer", () => {
  let storage: GraphStorage;
  let analyzer: DependencyClusterAnalyzer;

  beforeEach(() => {
    storage = new GraphStorage(":memory:");
    analyzer = new DependencyClusterAnalyzer(storage);
  });

  afterEach(() => {
    storage.close();
  });

  it("should return empty array for empty graph", () => {
    const clusters = analyzer.analyze();
    expect(clusters).toHaveLength(0);
  });

  it("should detect a single cluster", () => {
    storage.insertEdges([
      makeEdge("/src/a.ts", "/src/b.ts"),
      makeEdge("/src/b.ts", "/src/c.ts"),
    ]);

    const clusters = analyzer.analyze();
    expect(clusters).toHaveLength(1);
    expect(clusters[0].files.sort()).toEqual([
      "/src/a.ts",
      "/src/b.ts",
      "/src/c.ts",
    ]);
    expect(clusters[0].internalEdgeCount).toBe(2);
  });

  it("should detect two disconnected clusters", () => {
    storage.insertEdges([
      makeEdge("/src/a.ts", "/src/b.ts"),
      makeEdge("/src/x.ts", "/src/y.ts"),
    ]);

    const clusters = analyzer.analyze();
    expect(clusters).toHaveLength(2);

    const clusterFiles = clusters.map((c) => c.files.sort());
    expect(clusterFiles).toContainEqual(["/src/a.ts", "/src/b.ts"]);
    expect(clusterFiles).toContainEqual(["/src/x.ts", "/src/y.ts"]);
  });

  it("should handle bidirectional edges", () => {
    storage.insertEdges([
      makeEdge("/src/a.ts", "/src/b.ts", "a1", "b1"),
      makeEdge("/src/b.ts", "/src/a.ts", "b2", "a2"),
    ]);

    const clusters = analyzer.analyze();
    expect(clusters).toHaveLength(1);
    expect(clusters[0].files.sort()).toEqual(["/src/a.ts", "/src/b.ts"]);
    expect(clusters[0].internalEdgeCount).toBe(2);
  });

  it("should count internal edges correctly", () => {
    storage.insertEdges([
      makeEdge("/src/a.ts", "/src/b.ts", "a1", "b1"),
      makeEdge("/src/a.ts", "/src/c.ts", "a2", "c1"),
      makeEdge("/src/b.ts", "/src/c.ts", "b2", "c2"),
    ]);

    const clusters = analyzer.analyze();
    expect(clusters).toHaveLength(1);
    expect(clusters[0].internalEdgeCount).toBe(3);
  });

  it("should assign sequential cluster IDs", () => {
    storage.insertEdges([
      makeEdge("/src/a.ts", "/src/b.ts"),
      makeEdge("/src/x.ts", "/src/y.ts"),
      makeEdge("/src/m.ts", "/src/n.ts"),
    ]);

    const clusters = analyzer.analyze();
    expect(clusters).toHaveLength(3);
    const ids = clusters.map((c) => c.id).sort();
    expect(ids).toEqual([0, 1, 2]);
  });

  it("should handle star topology (one hub file)", () => {
    storage.insertEdges([
      makeEdge("/src/hub.ts", "/src/a.ts", "h1", "a1"),
      makeEdge("/src/hub.ts", "/src/b.ts", "h2", "b1"),
      makeEdge("/src/hub.ts", "/src/c.ts", "h3", "c1"),
    ]);

    const clusters = analyzer.analyze();
    expect(clusters).toHaveLength(1);
    expect(clusters[0].files).toHaveLength(4);
  });

  it("should exclude edges with null target files", () => {
    storage.insertEdges([
      {
        sourceId: "a",
        targetId: "unresolved:ext",
        relationshipType: "imports",
        sourceFile: "/src/a.ts",
        targetFile: null,
      },
    ]);

    const clusters = analyzer.analyze();
    expect(clusters).toHaveLength(0);
  });

  it("should sort files within each cluster", () => {
    storage.insertEdges([
      makeEdge("/src/z.ts", "/src/a.ts"),
      makeEdge("/src/a.ts", "/src/m.ts"),
    ]);

    const clusters = analyzer.analyze();
    expect(clusters).toHaveLength(1);
    expect(clusters[0].files).toEqual(["/src/a.ts", "/src/m.ts", "/src/z.ts"]);
  });
});
