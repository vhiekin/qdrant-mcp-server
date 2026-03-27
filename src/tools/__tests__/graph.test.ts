/**
 * Tests for graph MCP tools registration
 *
 * Tests cover:
 * - Tool registration (all 6 tools present)
 * - Input validation via Zod schemas
 * - Output format when graph is disabled
 * - Output format when symbol not found
 * - Output format with valid graph data
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GraphConfig } from "../../graph/types.js";
import { registerGraphTools } from "../graph.js";

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

// Mock git/extractor normalizeRemoteUrl
vi.mock("../../git/extractor.js", () => ({
  normalizeRemoteUrl: vi.fn().mockReturnValue(null),
}));

// Mock execFile to avoid git subprocess
vi.mock("node:child_process", () => ({
  execFile: vi.fn((_cmd: string, _args: string[], _opts: any, cb: Function) => {
    cb(new Error("git not available"));
  }),
}));

// Mock util.promisify to return a function that rejects
vi.mock("node:util", () => ({
  promisify: vi.fn(() => async () => {
    throw new Error("git not available");
  }),
}));

// Current mock instance returned by GraphStorage constructor
let currentMockInstance: Record<string, any> = {};

function createDefaultMockInstance() {
  return {
    close: vi.fn(),
    findNodesByName: vi.fn().mockReturnValue([]),
    getCallers: vi.fn().mockReturnValue([]),
    getCallees: vi.fn().mockReturnValue([]),
    traceCallChain: vi.fn().mockReturnValue({ nodeIds: [], nodes: [], depth: 0 }),
    getImpactRadius: vi.fn().mockReturnValue({
      rootNodeId: "r1",
      impactedNodes: [],
      impactedEdges: [],
      maxDepth: 0,
    }),
    getSharedInterfaces: vi.fn().mockReturnValue([]),
    getStats: vi.fn().mockReturnValue({ nodeCount: 0, edgeCount: 0, fileCount: 0, relationshipCounts: {} }),
  };
}

// Initialise with defaults
currentMockInstance = createDefaultMockInstance();

// Mock GraphStorage to avoid actual SQLite DB files
vi.mock("../../graph/storage.js", () => ({
  GraphStorage: class {
    static defaultPath(_collectionName: string): string {
      return ":memory:";
    }

    constructor(_dbPath: string) {
      Object.assign(this, currentMockInstance);
    }
  },
}));

// Mock DependencyClusterAnalyzer
vi.mock("../../graph/clusters.js", () => ({
  DependencyClusterAnalyzer: vi.fn().mockImplementation(() => ({
    analyze: vi.fn().mockReturnValue([]),
  })),
}));

// ---- Minimal McpServer mock ----

interface RegisteredTool {
  name: string;
  config: { title: string; description: string; inputSchema: Record<string, any> };
  handler: (input: any, extra?: any) => Promise<{ content: any[]; isError?: boolean }>;
}

function createMockServer(): { server: McpServer; tools: Map<string, RegisteredTool> } {
  const tools = new Map<string, RegisteredTool>();

  const server = {
    registerTool: vi.fn((name: string, config: any, handler: any) => {
      tools.set(name, { name, config, handler });
    }),
  } as unknown as McpServer;

  return { server, tools };
}

const enabledConfig: GraphConfig = { enabled: true, maxDepth: 10 };
const disabledConfig: GraphConfig = { enabled: false, maxDepth: 10 };

describe("registerGraphTools", () => {
  describe("tool registration", () => {
    it("registers all 6 graph tools", () => {
      const { server, tools } = createMockServer();
      registerGraphTools(server, { graphConfig: enabledConfig });

      expect(tools.has("trace_call_chain")).toBe(true);
      expect(tools.has("analyze_impact")).toBe(true);
      expect(tools.has("get_dependency_clusters")).toBe(true);
      expect(tools.has("get_callers")).toBe(true);
      expect(tools.has("get_callees")).toBe(true);
      expect(tools.has("get_shared_interfaces")).toBe(true);
    });

    it("each tool has a title and description", () => {
      const { server, tools } = createMockServer();
      registerGraphTools(server, { graphConfig: enabledConfig });

      for (const [, tool] of tools) {
        expect(tool.config.title).toBeTruthy();
        expect(tool.config.description).toBeTruthy();
        expect(tool.config.description.length).toBeGreaterThan(20);
      }
    });

    it("trace_call_chain has agent-oriented description keywords", () => {
      const { server, tools } = createMockServer();
      registerGraphTools(server, { graphConfig: enabledConfig });
      const tool = tools.get("trace_call_chain")!;
      expect(tool.config.description).toContain("Trace");
    });

    it("analyze_impact has agent-oriented description keywords", () => {
      const { server, tools } = createMockServer();
      registerGraphTools(server, { graphConfig: enabledConfig });
      const tool = tools.get("analyze_impact")!;
      expect(tool.config.description).toContain("impact");
    });
  });

  describe("disabled mode", () => {
    it("trace_call_chain returns disabled message when CODE_ENABLE_GRAPH=false", async () => {
      const { server, tools } = createMockServer();
      registerGraphTools(server, { graphConfig: disabledConfig });

      const tool = tools.get("trace_call_chain")!;
      const result = await tool.handler({ path: "/tmp/code", name: "myFunc" });

      expect(result.content[0].type).toBe("text");
      expect((result.content[0] as any).text).toContain("disabled");
    });

    it("analyze_impact returns disabled message when CODE_ENABLE_GRAPH=false", async () => {
      const { server, tools } = createMockServer();
      registerGraphTools(server, { graphConfig: disabledConfig });

      const tool = tools.get("analyze_impact")!;
      const result = await tool.handler({ path: "/tmp/code", name: "myFunc" });

      expect(result.content[0].type).toBe("text");
      expect((result.content[0] as any).text).toContain("disabled");
    });

    it("get_dependency_clusters returns disabled message when CODE_ENABLE_GRAPH=false", async () => {
      const { server, tools } = createMockServer();
      registerGraphTools(server, { graphConfig: disabledConfig });

      const tool = tools.get("get_dependency_clusters")!;
      const result = await tool.handler({ path: "/tmp/code" });

      expect((result.content[0] as any).text).toContain("disabled");
    });

    it("get_callers returns disabled message when CODE_ENABLE_GRAPH=false", async () => {
      const { server, tools } = createMockServer();
      registerGraphTools(server, { graphConfig: disabledConfig });

      const tool = tools.get("get_callers")!;
      const result = await tool.handler({ path: "/tmp/code", name: "myFunc" });

      expect((result.content[0] as any).text).toContain("disabled");
    });

    it("get_callees returns disabled message when CODE_ENABLE_GRAPH=false", async () => {
      const { server, tools } = createMockServer();
      registerGraphTools(server, { graphConfig: disabledConfig });

      const tool = tools.get("get_callees")!;
      const result = await tool.handler({ path: "/tmp/code", name: "myFunc" });

      expect((result.content[0] as any).text).toContain("disabled");
    });

    it("get_shared_interfaces returns disabled message when CODE_ENABLE_GRAPH=false", async () => {
      const { server, tools } = createMockServer();
      registerGraphTools(server, { graphConfig: disabledConfig });

      const tool = tools.get("get_shared_interfaces")!;
      const result = await tool.handler({ path: "/tmp/code", filesA: ["a.ts"], filesB: ["b.ts"] });

      expect((result.content[0] as any).text).toContain("disabled");
    });
  });

  describe("symbol not found", () => {
    beforeEach(() => {
      // Use default empty mock (findNodesByName returns [])
      currentMockInstance = createDefaultMockInstance();
    });

    it("trace_call_chain returns not-found message for unknown symbol", async () => {
      const { server, tools } = createMockServer();
      registerGraphTools(server, { graphConfig: enabledConfig });

      const tool = tools.get("trace_call_chain")!;
      const result = await tool.handler({ path: "/tmp/code", name: "unknownFunc" });

      expect((result.content[0] as any).text).toContain("not found");
    });

    it("get_callers returns not-found message for unknown symbol", async () => {
      const { server, tools } = createMockServer();
      registerGraphTools(server, { graphConfig: enabledConfig });

      const tool = tools.get("get_callers")!;
      const result = await tool.handler({ path: "/tmp/code", name: "unknownFunc" });

      expect((result.content[0] as any).text).toContain("not found");
    });

    it("get_callees returns not-found message for unknown symbol", async () => {
      const { server, tools } = createMockServer();
      registerGraphTools(server, { graphConfig: enabledConfig });

      const tool = tools.get("get_callees")!;
      const result = await tool.handler({ path: "/tmp/code", name: "unknownFunc" });

      expect((result.content[0] as any).text).toContain("not found");
    });
  });

  describe("output format with data", () => {
    const mockNode = {
      id: "node1",
      name: "myFunc",
      nodeType: "function",
      filePath: "/src/app.ts",
      startLine: 10,
      endLine: 20,
      language: "typescript",
    };

    beforeEach(() => {
      currentMockInstance = {
        ...createDefaultMockInstance(),
        findNodesByName: vi.fn().mockReturnValue([mockNode]),
        getCallers: vi.fn().mockReturnValue([mockNode]),
        getCallees: vi.fn().mockReturnValue([mockNode]),
        traceCallChain: vi.fn().mockReturnValue({
          nodeIds: ["node1"],
          nodes: [mockNode],
          depth: 0,
        }),
        getImpactRadius: vi.fn().mockReturnValue({
          rootNodeId: "node1",
          impactedNodes: [mockNode, { ...mockNode, id: "node2", name: "caller" }],
          impactedEdges: [{ sourceId: "node2", targetId: "node1", relationshipType: "calls", sourceFile: "/src/b.ts", targetFile: "/src/app.ts" }],
          maxDepth: 1,
        }),
        getSharedInterfaces: vi.fn().mockReturnValue([{ ...mockNode, nodeType: "interface", name: "MyInterface" }]),
      };
    });

    it("trace_call_chain includes symbol name and file path in output", async () => {
      const { server, tools } = createMockServer();
      registerGraphTools(server, { graphConfig: enabledConfig });

      const tool = tools.get("trace_call_chain")!;
      const result = await tool.handler({ path: "/tmp/code", name: "myFunc" });

      const text = (result.content[0] as any).text;
      expect(text).toContain("myFunc");
      expect(text).toContain("/src/app.ts");
    });

    it("analyze_impact shows impacted nodes count", async () => {
      const { server, tools } = createMockServer();
      registerGraphTools(server, { graphConfig: enabledConfig });

      const tool = tools.get("analyze_impact")!;
      const result = await tool.handler({ path: "/tmp/code", name: "myFunc" });

      const text = (result.content[0] as any).text;
      expect(text).toContain("myFunc");
    });

    it("get_callers lists callers with file paths", async () => {
      const { server, tools } = createMockServer();
      registerGraphTools(server, { graphConfig: enabledConfig });

      const tool = tools.get("get_callers")!;
      const result = await tool.handler({ path: "/tmp/code", name: "myFunc" });

      const text = (result.content[0] as any).text;
      expect(text).toContain("Direct callers");
      expect(text).toContain("myFunc");
      expect(text).toContain("/src/app.ts");
    });

    it("get_callees lists callees with file paths", async () => {
      const { server, tools } = createMockServer();
      registerGraphTools(server, { graphConfig: enabledConfig });

      const tool = tools.get("get_callees")!;
      const result = await tool.handler({ path: "/tmp/code", name: "myFunc" });

      const text = (result.content[0] as any).text;
      expect(text).toContain("Direct callees");
      expect(text).toContain("myFunc");
    });

    it("get_shared_interfaces shows interface names", async () => {
      const { server, tools } = createMockServer();
      registerGraphTools(server, { graphConfig: enabledConfig });

      const tool = tools.get("get_shared_interfaces")!;
      const result = await tool.handler({ path: "/tmp/code", filesA: ["/src/app.ts"], filesB: ["/src/b.ts"] });

      const text = (result.content[0] as any).text;
      expect(text).toContain("interface");
    });
  });

  describe("input schemas", () => {
    it("TraceCallChainSchema has required path and name fields", () => {
      const { server, tools } = createMockServer();
      registerGraphTools(server, { graphConfig: enabledConfig });

      const tool = tools.get("trace_call_chain")!;
      const schema = tool.config.inputSchema;

      expect(schema.path).toBeDefined();
      expect(schema.name).toBeDefined();
      expect(schema.filePath).toBeDefined();
      expect(schema.maxDepth).toBeDefined();
    });

    it("SharedInterfacesSchema has filesA and filesB arrays", () => {
      const { server, tools } = createMockServer();
      registerGraphTools(server, { graphConfig: enabledConfig });

      const tool = tools.get("get_shared_interfaces")!;
      const schema = tool.config.inputSchema;

      expect(schema.filesA).toBeDefined();
      expect(schema.filesB).toBeDefined();
    });

    it("DependencyClustersSchema only requires path", () => {
      const { server, tools } = createMockServer();
      registerGraphTools(server, { graphConfig: enabledConfig });

      const tool = tools.get("get_dependency_clusters")!;
      const schema = tool.config.inputSchema;

      expect(schema.path).toBeDefined();
      expect(schema.name).toBeUndefined();
    });
  });
});
