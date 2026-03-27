import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GraphStorage } from "../storage.js";
import type { GraphNode, GraphEdge } from "../types.js";

// Mock logger
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

function makeNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: "node_" + Math.random().toString(36).slice(2, 10),
    name: "testFunc",
    nodeType: "function",
    filePath: "/src/test.ts",
    startLine: 1,
    endLine: 10,
    language: "typescript",
    ...overrides,
  };
}

function makeEdge(overrides: Partial<GraphEdge> = {}): GraphEdge {
  return {
    sourceId: "source1",
    targetId: "target1",
    relationshipType: "calls",
    sourceFile: "/src/a.ts",
    targetFile: "/src/b.ts",
    ...overrides,
  };
}

describe("GraphStorage", () => {
  let storage: GraphStorage;

  beforeEach(() => {
    storage = new GraphStorage(":memory:");
  });

  afterEach(() => {
    storage.close();
  });

  describe("constructor", () => {
    it("should create an in-memory database", () => {
      expect(storage).toBeDefined();
    });
  });

  describe("defaultPath", () => {
    it("should return a path under ~/.qdrant-mcp/graph/", () => {
      const path = GraphStorage.defaultPath("my_collection");
      expect(path).toContain(".qdrant-mcp");
      expect(path).toContain("graph");
      expect(path).toContain("my_collection.db");
    });
  });

  describe("insertNodes / getNode", () => {
    it("should insert and retrieve a single node", () => {
      const node = makeNode({ id: "abc123", name: "myFunc" });
      storage.insertNodes([node]);

      const retrieved = storage.getNode("abc123");
      expect(retrieved).toBeDefined();
      expect(retrieved!.name).toBe("myFunc");
      expect(retrieved!.nodeType).toBe("function");
    });

    it("should handle empty array", () => {
      storage.insertNodes([]);
      // Should not throw
    });

    it("should replace existing node with same ID", () => {
      const node1 = makeNode({ id: "abc", name: "v1" });
      const node2 = makeNode({ id: "abc", name: "v2" });
      storage.insertNodes([node1]);
      storage.insertNodes([node2]);

      const retrieved = storage.getNode("abc");
      expect(retrieved!.name).toBe("v2");
    });
  });

  describe("insertEdges", () => {
    it("should insert edges", () => {
      const edge = makeEdge({ sourceId: "a", targetId: "b" });
      storage.insertEdges([edge]);

      const node = makeNode({ id: "a" });
      storage.insertNodes([node]);

      const outgoing = storage.getOutgoingEdges("a");
      expect(outgoing).toHaveLength(1);
      expect(outgoing[0].targetId).toBe("b");
    });

    it("should handle empty array", () => {
      storage.insertEdges([]);
    });

    it("should ignore duplicate edges (same PK)", () => {
      const edge = makeEdge({
        sourceId: "a",
        targetId: "b",
        relationshipType: "calls",
      });
      storage.insertEdges([edge]);
      storage.insertEdges([edge]); // duplicate
      // Should not throw
    });
  });

  describe("deleteByFiles", () => {
    it("should delete nodes and edges for given files", () => {
      const node = makeNode({
        id: "n1",
        filePath: "/src/a.ts",
      });
      const edge = makeEdge({
        sourceId: "n1",
        targetId: "n2",
        sourceFile: "/src/a.ts",
      });

      storage.insertNodes([node]);
      storage.insertEdges([edge]);

      storage.deleteByFiles(["/src/a.ts"]);

      expect(storage.getNode("n1")).toBeUndefined();
      expect(storage.getOutgoingEdges("n1")).toHaveLength(0);
    });

    it("should handle empty array", () => {
      storage.deleteByFiles([]);
    });

    it("should not delete unrelated files", () => {
      const node1 = makeNode({ id: "n1", filePath: "/src/a.ts" });
      const node2 = makeNode({ id: "n2", filePath: "/src/b.ts" });
      storage.insertNodes([node1, node2]);

      storage.deleteByFiles(["/src/a.ts"]);

      expect(storage.getNode("n1")).toBeUndefined();
      expect(storage.getNode("n2")).toBeDefined();
    });

    it("should delete incoming edges (target_file) when a file is removed", () => {
      // n1 in /src/a.ts imports n2 in /src/b.ts
      const node1 = makeNode({ id: "n1", filePath: "/src/a.ts" });
      const node2 = makeNode({ id: "n2", filePath: "/src/b.ts" });
      storage.insertNodes([node1, node2]);

      // Edge goes FROM a.ts TO b.ts
      const edge = makeEdge({
        sourceId: "n1",
        targetId: "n2",
        sourceFile: "/src/a.ts",
        targetFile: "/src/b.ts",
      });
      storage.insertEdges([edge]);

      // Deleting b.ts should also remove the edge that targets it
      storage.deleteByFiles(["/src/b.ts"]);

      expect(storage.getNode("n2")).toBeUndefined();
      // The incoming edge from a.ts → b.ts should be gone
      expect(storage.getIncomingEdges("n2")).toHaveLength(0);
      // And it should not appear in outgoing edges from n1 either
      expect(storage.getOutgoingEdges("n1")).toHaveLength(0);
    });
  });

  describe("getNodesByFile", () => {
    it("should return all nodes in a file", () => {
      const n1 = makeNode({
        id: "n1",
        name: "func1",
        filePath: "/src/a.ts",
      });
      const n2 = makeNode({
        id: "n2",
        name: "func2",
        filePath: "/src/a.ts",
      });
      const n3 = makeNode({
        id: "n3",
        name: "func3",
        filePath: "/src/b.ts",
      });

      storage.insertNodes([n1, n2, n3]);

      const nodesInA = storage.getNodesByFile("/src/a.ts");
      expect(nodesInA).toHaveLength(2);
      expect(nodesInA.map((n) => n.name).sort()).toEqual(["func1", "func2"]);
    });
  });

  describe("getCallers / getCallees", () => {
    it("should find callers of a node", () => {
      const caller = makeNode({ id: "caller1", name: "main" });
      const callee = makeNode({ id: "callee1", name: "helper" });
      storage.insertNodes([caller, callee]);
      storage.insertEdges([
        makeEdge({
          sourceId: "caller1",
          targetId: "callee1",
          relationshipType: "calls",
        }),
      ]);

      const callers = storage.getCallers("callee1");
      expect(callers).toHaveLength(1);
      expect(callers[0].name).toBe("main");
    });

    it("should find callees of a node", () => {
      const caller = makeNode({ id: "caller1", name: "main" });
      const callee = makeNode({ id: "callee1", name: "helper" });
      storage.insertNodes([caller, callee]);
      storage.insertEdges([
        makeEdge({
          sourceId: "caller1",
          targetId: "callee1",
          relationshipType: "calls",
        }),
      ]);

      const callees = storage.getCallees("caller1");
      expect(callees).toHaveLength(1);
      expect(callees[0].name).toBe("helper");
    });

    it("should not return non-call relationships", () => {
      const n1 = makeNode({ id: "n1" });
      const n2 = makeNode({ id: "n2" });
      storage.insertNodes([n1, n2]);
      storage.insertEdges([
        makeEdge({
          sourceId: "n1",
          targetId: "n2",
          relationshipType: "imports",
        }),
      ]);

      expect(storage.getCallers("n2")).toHaveLength(0);
      expect(storage.getCallees("n1")).toHaveLength(0);
    });
  });

  describe("getOutgoingEdges / getIncomingEdges", () => {
    it("should return outgoing edges", () => {
      storage.insertEdges([
        makeEdge({
          sourceId: "a",
          targetId: "b",
          relationshipType: "calls",
        }),
        makeEdge({
          sourceId: "a",
          targetId: "c",
          relationshipType: "imports",
        }),
      ]);

      const outgoing = storage.getOutgoingEdges("a");
      expect(outgoing).toHaveLength(2);
    });

    it("should return incoming edges", () => {
      storage.insertEdges([
        makeEdge({
          sourceId: "a",
          targetId: "b",
          relationshipType: "calls",
        }),
        makeEdge({
          sourceId: "c",
          targetId: "b",
          relationshipType: "calls",
        }),
      ]);

      const incoming = storage.getIncomingEdges("b");
      expect(incoming).toHaveLength(2);
    });
  });

  describe("traceCallChain", () => {
    it("should trace a linear call chain", () => {
      const n1 = makeNode({ id: "a", name: "funcA" });
      const n2 = makeNode({ id: "b", name: "funcB" });
      const n3 = makeNode({ id: "c", name: "funcC" });
      storage.insertNodes([n1, n2, n3]);
      storage.insertEdges([
        makeEdge({
          sourceId: "a",
          targetId: "b",
          relationshipType: "calls",
        }),
        makeEdge({
          sourceId: "b",
          targetId: "c",
          relationshipType: "calls",
        }),
      ]);

      const chain = storage.traceCallChain("a", 10);
      expect(chain.nodeIds).toContain("a");
      expect(chain.nodeIds).toContain("b");
      expect(chain.nodeIds).toContain("c");
    });

    it("should respect maxDepth", () => {
      const n1 = makeNode({ id: "a" });
      const n2 = makeNode({ id: "b" });
      const n3 = makeNode({ id: "c" });
      storage.insertNodes([n1, n2, n3]);
      storage.insertEdges([
        makeEdge({
          sourceId: "a",
          targetId: "b",
          relationshipType: "calls",
        }),
        makeEdge({
          sourceId: "b",
          targetId: "c",
          relationshipType: "calls",
        }),
      ]);

      const chain = storage.traceCallChain("a", 1);
      // Should include a and b, but c is at depth 2
      expect(chain.nodeIds).toContain("a");
      expect(chain.nodeIds).toContain("b");
      expect(chain.nodeIds).not.toContain("c");
    });

    it("should handle cycles without infinite loops", () => {
      const n1 = makeNode({ id: "a" });
      const n2 = makeNode({ id: "b" });
      storage.insertNodes([n1, n2]);
      storage.insertEdges([
        makeEdge({
          sourceId: "a",
          targetId: "b",
          relationshipType: "calls",
        }),
        makeEdge({
          sourceId: "b",
          targetId: "a",
          relationshipType: "calls",
        }),
      ]);

      const chain = storage.traceCallChain("a", 10);
      // Should visit both but not loop
      expect(chain.nodeIds).toContain("a");
      expect(chain.nodeIds).toContain("b");
      expect(chain.nodeIds.length).toBeLessThanOrEqual(3);
    });
  });

  describe("getImpactRadius", () => {
    it("should find reverse call chain (who calls me)", () => {
      const n1 = makeNode({ id: "a", name: "caller" });
      const n2 = makeNode({ id: "b", name: "target" });
      storage.insertNodes([n1, n2]);
      storage.insertEdges([
        makeEdge({
          sourceId: "a",
          targetId: "b",
          relationshipType: "calls",
        }),
      ]);

      const impact = storage.getImpactRadius("b", 10);
      expect(impact.rootNodeId).toBe("b");
      expect(impact.impactedNodes.map((n) => n.id)).toContain("a");
      expect(impact.impactedEdges).toHaveLength(1);
    });

    it("should respect maxDepth", () => {
      const n1 = makeNode({ id: "a" });
      const n2 = makeNode({ id: "b" });
      const n3 = makeNode({ id: "c" });
      storage.insertNodes([n1, n2, n3]);
      storage.insertEdges([
        makeEdge({
          sourceId: "a",
          targetId: "b",
          relationshipType: "calls",
        }),
        makeEdge({
          sourceId: "b",
          targetId: "c",
          relationshipType: "calls",
        }),
      ]);

      const impact = storage.getImpactRadius("c", 1);
      expect(impact.impactedNodes.map((n) => n.id)).toContain("c");
      expect(impact.impactedNodes.map((n) => n.id)).toContain("b");
      expect(impact.impactedNodes.map((n) => n.id)).not.toContain("a");
    });

    it("should handle cycles", () => {
      const n1 = makeNode({ id: "a" });
      const n2 = makeNode({ id: "b" });
      storage.insertNodes([n1, n2]);
      storage.insertEdges([
        makeEdge({
          sourceId: "a",
          targetId: "b",
          relationshipType: "calls",
        }),
        makeEdge({
          sourceId: "b",
          targetId: "a",
          relationshipType: "calls",
        }),
      ]);

      const impact = storage.getImpactRadius("a", 10);
      expect(impact.impactedNodes.length).toBeLessThanOrEqual(3);
    });
  });

  describe("getSharedInterfaces", () => {
    it("should find interfaces referenced from multiple files", () => {
      const iface = makeNode({
        id: "iface1",
        name: "Serializable",
        nodeType: "interface",
      });
      storage.insertNodes([iface]);
      storage.insertEdges([
        makeEdge({
          sourceId: "a",
          targetId: "iface1",
          sourceFile: "/src/a.ts",
        }),
        makeEdge({
          sourceId: "b",
          targetId: "iface1",
          sourceFile: "/src/b.ts",
        }),
      ]);

      const shared = storage.getSharedInterfaces();
      expect(shared).toHaveLength(1);
      expect(shared[0].name).toBe("Serializable");
    });

    it("should not return interfaces referenced from only one file", () => {
      const iface = makeNode({
        id: "iface1",
        name: "Local",
        nodeType: "interface",
      });
      storage.insertNodes([iface]);
      storage.insertEdges([
        makeEdge({
          sourceId: "a",
          targetId: "iface1",
          sourceFile: "/src/a.ts",
        }),
      ]);

      const shared = storage.getSharedInterfaces();
      expect(shared).toHaveLength(0);
    });
  });

  describe("getStats", () => {
    it("should return correct statistics", () => {
      storage.insertNodes([
        makeNode({ id: "n1", filePath: "/src/a.ts" }),
        makeNode({ id: "n2", filePath: "/src/b.ts" }),
      ]);
      storage.insertEdges([
        makeEdge({
          sourceId: "n1",
          targetId: "n2",
          relationshipType: "calls",
        }),
        makeEdge({
          sourceId: "n1",
          targetId: "n2",
          relationshipType: "imports",
        }),
      ]);

      const stats = storage.getStats();
      expect(stats.nodeCount).toBe(2);
      expect(stats.edgeCount).toBe(2);
      expect(stats.fileCount).toBe(2);
      expect(stats.relationshipCounts.calls).toBe(1);
      expect(stats.relationshipCounts.imports).toBe(1);
      expect(stats.relationshipCounts.extends).toBe(0);
    });

    it("should return zeros for empty database", () => {
      const stats = storage.getStats();
      expect(stats.nodeCount).toBe(0);
      expect(stats.edgeCount).toBe(0);
      expect(stats.fileCount).toBe(0);
    });
  });

  describe("getFilePairs", () => {
    it("should return distinct file pairs from edges", () => {
      storage.insertEdges([
        makeEdge({
          sourceId: "a",
          targetId: "b",
          sourceFile: "/src/a.ts",
          targetFile: "/src/b.ts",
        }),
        makeEdge({
          sourceId: "a",
          targetId: "c",
          sourceFile: "/src/a.ts",
          targetFile: "/src/c.ts",
        }),
      ]);

      const pairs = storage.getFilePairs();
      expect(pairs).toHaveLength(2);
    });

    it("should exclude null target files", () => {
      storage.insertEdges([
        makeEdge({
          sourceId: "a",
          targetId: "b",
          sourceFile: "/src/a.ts",
          targetFile: null,
        }),
      ]);

      const pairs = storage.getFilePairs();
      expect(pairs).toHaveLength(0);
    });

    it("should throw when scale guard is exceeded", () => {
      // Insert one pair but set maxPairs to 0
      storage.insertEdges([
        makeEdge({
          sourceId: "a",
          targetId: "b",
          sourceFile: "/src/a.ts",
          targetFile: "/src/b.ts",
        }),
      ]);

      expect(() => storage.getFilePairs(0)).toThrow("scale guard");
    });
  });
});
