import { describe, it, expect } from "vitest";
import {
  NAME_VALIDATION_REGEX,
  UNRESOLVED_PREFIX,
} from "../types.js";
import type {
  GraphNode,
  GraphEdge,
  RelationshipType,
  NodeType,
  GraphConfig,
  ExtractionResult,
  GraphStats,
  CallChain,
  ImpactResult,
  Cluster,
  SharedNode,
} from "../types.js";

describe("Graph Types", () => {
  describe("NAME_VALIDATION_REGEX", () => {
    it("should accept valid symbol names", () => {
      const validNames = [
        "foo",
        "Bar",
        "_private",
        "$jquery",
        "my_func",
        "MyClass",
        "a",
        "a1",
        "foo.bar",
        "foo.bar.baz",
        "foo*",
        "$",
        "_",
      ];
      for (const name of validNames) {
        expect(
          NAME_VALIDATION_REGEX.test(name),
          `Expected "${name}" to be valid`,
        ).toBe(true);
      }
    });

    it("should reject invalid symbol names", () => {
      const invalidNames = [
        "",
        "1foo",
        ".foo",
        "*foo",
        "foo bar",
        "foo-bar",
        "123",
        " ",
        "foo/bar",
      ];
      for (const name of invalidNames) {
        expect(
          NAME_VALIDATION_REGEX.test(name),
          `Expected "${name}" to be invalid`,
        ).toBe(false);
      }
    });
  });

  describe("UNRESOLVED_PREFIX", () => {
    it("should equal 'unresolved:'", () => {
      expect(UNRESOLVED_PREFIX).toBe("unresolved:");
    });
  });

  describe("Type shapes (compile-time checks)", () => {
    it("should allow constructing a valid GraphNode", () => {
      const node: GraphNode = {
        id: "abcdef1234567890",
        name: "myFunction",
        nodeType: "function",
        filePath: "/src/index.ts",
        startLine: 1,
        endLine: 10,
        language: "typescript",
      };
      expect(node.id).toBe("abcdef1234567890");
      expect(node.nodeType).toBe("function");
    });

    it("should allow constructing a valid GraphEdge", () => {
      const edge: GraphEdge = {
        sourceId: "abc123",
        targetId: "def456",
        relationshipType: "calls",
        sourceFile: "/src/a.ts",
        targetFile: "/src/b.ts",
      };
      expect(edge.relationshipType).toBe("calls");
    });

    it("should allow null targetFile for unresolved edges", () => {
      const edge: GraphEdge = {
        sourceId: "abc123",
        targetId: "unresolved:lodash",
        relationshipType: "imports",
        sourceFile: "/src/a.ts",
        targetFile: null,
      };
      expect(edge.targetFile).toBeNull();
    });

    it("should allow all relationship types", () => {
      const types: RelationshipType[] = [
        "calls",
        "imports",
        "extends",
        "implements",
        "uses_type",
      ];
      expect(types).toHaveLength(5);
    });

    it("should allow all node types", () => {
      const types: NodeType[] = [
        "function",
        "method",
        "class",
        "interface",
        "module",
        "type",
        "variable",
      ];
      expect(types).toHaveLength(7);
    });

    it("should allow constructing GraphConfig", () => {
      const config: GraphConfig = {
        enabled: true,
        maxDepth: 10,
      };
      expect(config.enabled).toBe(true);
    });

    it("should allow constructing ExtractionResult", () => {
      const result: ExtractionResult = {
        nodes: [],
        edges: [],
        filePath: "/src/test.ts",
        language: "typescript",
      };
      expect(result.nodes).toHaveLength(0);
    });

    it("should allow constructing GraphStats", () => {
      const stats: GraphStats = {
        nodeCount: 10,
        edgeCount: 20,
        fileCount: 5,
        relationshipCounts: {
          calls: 8,
          imports: 5,
          extends: 3,
          implements: 2,
          uses_type: 2,
        },
      };
      expect(stats.nodeCount).toBe(10);
    });

    it("should allow constructing CallChain", () => {
      const chain: CallChain = {
        nodeIds: ["a", "b", "c"],
        nodes: [],
        depth: 2,
      };
      expect(chain.depth).toBe(2);
    });

    it("should allow constructing ImpactResult", () => {
      const impact: ImpactResult = {
        rootNodeId: "abc",
        impactedNodes: [],
        impactedEdges: [],
        maxDepth: 3,
      };
      expect(impact.rootNodeId).toBe("abc");
    });

    it("should allow constructing Cluster", () => {
      const cluster: Cluster = {
        id: 1,
        files: ["/src/a.ts", "/src/b.ts"],
        internalEdgeCount: 5,
      };
      expect(cluster.files).toHaveLength(2);
    });

    it("should allow constructing SharedNode", () => {
      const shared: SharedNode = {
        node: {
          id: "abc",
          name: "shared",
          nodeType: "interface",
          filePath: "/src/types.ts",
          startLine: 1,
          endLine: 5,
          language: "typescript",
        },
        clusterIds: [1, 2, 3],
      };
      expect(shared.clusterIds).toHaveLength(3);
    });
  });
});
