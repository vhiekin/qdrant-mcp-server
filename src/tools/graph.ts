/**
 * Graph analysis tools registration
 *
 * Provides 6 MCP tools for code graph analysis:
 * - trace_call_chain: Multi-hop call chain from a symbol
 * - analyze_impact: Who calls this symbol (impact radius)
 * - get_dependency_clusters: File-level cluster analysis
 * - get_callers: Single-hop callers of a symbol
 * - get_callees: Single-hop callees of a symbol
 * - get_shared_interfaces: Interfaces/types used across multiple files
 */

import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import logger from "../logger.js";
import { CodeIndexer } from "../code/indexer.js";
import { DependencyClusterAnalyzer } from "../graph/clusters.js";
import { GraphStorage } from "../graph/storage.js";
import type { GraphConfig } from "../graph/types.js";
import { withToolLogging } from "./logging.js";
import * as schemas from "./schemas.js";

const log = logger.child({ component: "graph-tools" });

export interface GraphToolDependencies {
  graphConfig: GraphConfig;
}

/**
 * Derive the collection name for a codebase path.
 * Delegates to CodeIndexer.getCollectionName to avoid logic duplication.
 */
async function collectionNameForPath(path: string): Promise<string> {
  return CodeIndexer.getCollectionName(resolve(path));
}

/**
 * Open a GraphStorage for the given codebase path.
 * Returns null if graph is disabled or the DB doesn't exist.
 */
function openStorage(
  collectionName: string,
): GraphStorage {
  const dbPath = GraphStorage.defaultPath(collectionName);
  return new GraphStorage(dbPath);
}

/**
 * Resolve a symbol name (+ optional filePath) to a node ID.
 * Returns the first matching node's ID, or null if not found.
 */
function resolveNodeId(
  storage: GraphStorage,
  name: string,
  filePath?: string,
): string | null {
  const nodes = storage.findNodesByName(name, filePath);
  if (nodes.length === 0) {
    return null;
  }
  return nodes[0].id;
}

export function registerGraphTools(
  server: McpServer,
  deps: GraphToolDependencies,
): void {
  const { graphConfig } = deps;

  // trace_call_chain
  server.registerTool(
    "trace_call_chain",
    {
      title: "Trace Call Chain",
      description:
        "Traces the full call chain from a symbol — follows outgoing 'calls' edges up to maxDepth hops. " +
        "Use this when you need to understand what a function eventually invokes (downstream execution path). " +
        "Returns an ordered list of symbols from root to leaves. " +
        "Trigger: 'what does X call?', 'trace execution from X', 'what happens when X runs?'",
      inputSchema: schemas.TraceCallChainSchema,
    },
    withToolLogging(
      "trace_call_chain",
      async ({ path, name, filePath, maxDepth }) => {
        log.info({ tool: "trace_call_chain", path, name }, "Tool called");

        if (!graphConfig.enabled) {
          return {
            content: [
              {
                type: "text",
                text: "Graph analysis is disabled. Set CODE_ENABLE_GRAPH=true to enable it.",
              },
            ],
          };
        }

        const collectionName = await collectionNameForPath(path);
        const storage = openStorage(collectionName);

        try {
          const nodeId = resolveNodeId(storage, name, filePath);
          if (!nodeId) {
            return {
              content: [
                {
                  type: "text",
                  text: `Symbol '${name}' not found in graph for codebase at "${path}". ` +
                    `Ensure the codebase is indexed with CODE_ENABLE_GRAPH=true.`,
                },
              ],
            };
          }

          const depth = maxDepth ?? graphConfig.maxDepth;
          const chain = storage.traceCallChain(nodeId, depth);

          if (chain.nodes.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: `No call chain found starting from '${name}'.`,
                },
              ],
            };
          }

          const lines: string[] = [
            `Call chain from '${name}' (depth: ${chain.depth}, nodes: ${chain.nodes.length}):`,
            "",
          ];
          chain.nodes.forEach((node, idx) => {
            lines.push(
              `${idx + 1}. ${node.name} [${node.nodeType}]`,
              `   File: ${node.filePath}:${node.startLine}-${node.endLine}`,
            );
          });

          return {
            content: [{ type: "text", text: lines.join("\n") }],
          };
        } finally {
          storage.close();
        }
      },
    ),
  );

  // analyze_impact
  server.registerTool(
    "analyze_impact",
    {
      title: "Analyze Impact",
      description:
        "Analyzes the impact radius of a symbol — finds all callers (direct and transitive) that would be " +
        "affected if this symbol changes. Traverses incoming 'calls' edges up to maxDepth hops. " +
        "Use before refactoring to understand blast radius. " +
        "Trigger: 'what calls X?', 'what breaks if I change X?', 'impact analysis for X'",
      inputSchema: schemas.ImpactAnalysisSchema,
    },
    withToolLogging(
      "analyze_impact",
      async ({ path, name, filePath, maxDepth }) => {
        log.info({ tool: "analyze_impact", path, name }, "Tool called");

        if (!graphConfig.enabled) {
          return {
            content: [
              {
                type: "text",
                text: "Graph analysis is disabled. Set CODE_ENABLE_GRAPH=true to enable it.",
              },
            ],
          };
        }

        const collectionName = await collectionNameForPath(path);
        const storage = openStorage(collectionName);

        try {
          const nodeId = resolveNodeId(storage, name, filePath);
          if (!nodeId) {
            return {
              content: [
                {
                  type: "text",
                  text: `Symbol '${name}' not found in graph for codebase at "${path}". ` +
                    `Ensure the codebase is indexed with CODE_ENABLE_GRAPH=true.`,
                },
              ],
            };
          }

          const depth = maxDepth ?? graphConfig.maxDepth;
          const result = storage.getImpactRadius(nodeId, depth);

          if (result.impactedNodes.length <= 1) {
            return {
              content: [
                {
                  type: "text",
                  text: `No callers found for '${name}'. This symbol has no incoming call edges.`,
                },
              ],
            };
          }

          // The first node in impactedNodes is the root node itself; callers start at index 1
          const affectedCallers = result.impactedNodes.filter(
            (n) => n.id !== result.rootNodeId,
          );
          const rootNode = result.impactedNodes.find(
            (n) => n.id === result.rootNodeId,
          );

          const lines: string[] = [
            `Impact analysis for '${name}' (max depth: ${result.maxDepth}, affected callers: ${affectedCallers.length}):`,
            "",
          ];
          if (rootNode) {
            lines.push(
              `Root: ${rootNode.name} [${rootNode.nodeType}]`,
              `   File: ${rootNode.filePath}:${rootNode.startLine}-${rootNode.endLine}`,
              "",
              "Callers:",
              "",
            );
          }
          affectedCallers.forEach((node, idx) => {
            lines.push(
              `${idx + 1}. ${node.name} [${node.nodeType}]`,
              `   File: ${node.filePath}:${node.startLine}-${node.endLine}`,
            );
          });
          lines.push("", `Total edges in impact radius: ${result.impactedEdges.length}`);

          return {
            content: [{ type: "text", text: lines.join("\n") }],
          };
        } finally {
          storage.close();
        }
      },
    ),
  );

  // get_dependency_clusters
  server.registerTool(
    "get_dependency_clusters",
    {
      title: "Get Dependency Clusters",
      description:
        "Finds clusters of tightly-connected files using connected-components analysis on the dependency graph. " +
        "Useful for understanding module boundaries, detecting coupling, and planning refactors. " +
        "Each cluster represents a group of files that have direct dependencies between them. " +
        "Trigger: 'find module clusters', 'show dependency groups', 'what files are coupled?'",
      inputSchema: schemas.DependencyClustersSchema,
    },
    withToolLogging(
      "get_dependency_clusters",
      async ({ path }) => {
        log.info({ tool: "get_dependency_clusters", path }, "Tool called");

        if (!graphConfig.enabled) {
          return {
            content: [
              {
                type: "text",
                text: "Graph analysis is disabled. Set CODE_ENABLE_GRAPH=true to enable it.",
              },
            ],
          };
        }

        const collectionName = await collectionNameForPath(path);
        const storage = openStorage(collectionName);

        try {
          const analyzer = new DependencyClusterAnalyzer(storage);
          const clusters = analyzer.analyze();

          if (clusters.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: `No dependency clusters found for codebase at "${path}". ` +
                    `Ensure the codebase is indexed with CODE_ENABLE_GRAPH=true.`,
                },
              ],
            };
          }

          const lines: string[] = [
            `Found ${clusters.length} dependency cluster(s):`,
            "",
          ];

          for (const cluster of clusters) {
            lines.push(
              `Cluster ${cluster.id + 1} (${cluster.files.length} files, ${cluster.internalEdgeCount} internal edges):`,
            );
            for (const file of cluster.files) {
              lines.push(`  - ${file}`);
            }
            lines.push("");
          }

          return {
            content: [{ type: "text", text: lines.join("\n") }],
          };
        } finally {
          storage.close();
        }
      },
    ),
  );

  // get_callers
  server.registerTool(
    "get_callers",
    {
      title: "Get Callers",
      description:
        "Returns direct callers of a symbol (one hop only). Shows which functions/methods call this symbol directly. " +
        "For multi-hop analysis use analyze_impact instead. " +
        "Trigger: 'who calls X?', 'direct callers of X', 'find usages of X'",
      inputSchema: schemas.GetCallersSchema,
    },
    withToolLogging(
      "get_callers",
      async ({ path, name, filePath }) => {
        log.info({ tool: "get_callers", path, name }, "Tool called");

        if (!graphConfig.enabled) {
          return {
            content: [
              {
                type: "text",
                text: "Graph analysis is disabled. Set CODE_ENABLE_GRAPH=true to enable it.",
              },
            ],
          };
        }

        const collectionName = await collectionNameForPath(path);
        const storage = openStorage(collectionName);

        try {
          const nodeId = resolveNodeId(storage, name, filePath);
          if (!nodeId) {
            return {
              content: [
                {
                  type: "text",
                  text: `Symbol '${name}' not found in graph for codebase at "${path}". ` +
                    `Ensure the codebase is indexed with CODE_ENABLE_GRAPH=true.`,
                },
              ],
            };
          }

          const callers = storage.getCallers(nodeId);

          if (callers.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: `No direct callers found for '${name}'.`,
                },
              ],
            };
          }

          const lines: string[] = [
            `Direct callers of '${name}' (${callers.length}):`,
            "",
          ];
          callers.forEach((node, idx) => {
            lines.push(
              `${idx + 1}. ${node.name} [${node.nodeType}]`,
              `   File: ${node.filePath}:${node.startLine}-${node.endLine}`,
            );
          });

          return {
            content: [{ type: "text", text: lines.join("\n") }],
          };
        } finally {
          storage.close();
        }
      },
    ),
  );

  // get_callees
  server.registerTool(
    "get_callees",
    {
      title: "Get Callees",
      description:
        "Returns direct callees of a symbol (one hop only). Shows which functions/methods this symbol calls directly. " +
        "For multi-hop analysis use trace_call_chain instead. " +
        "Trigger: 'what does X call directly?', 'direct dependencies of X', 'X calls what?'",
      inputSchema: schemas.GetCalleesSchema,
    },
    withToolLogging(
      "get_callees",
      async ({ path, name, filePath }) => {
        log.info({ tool: "get_callees", path, name }, "Tool called");

        if (!graphConfig.enabled) {
          return {
            content: [
              {
                type: "text",
                text: "Graph analysis is disabled. Set CODE_ENABLE_GRAPH=true to enable it.",
              },
            ],
          };
        }

        const collectionName = await collectionNameForPath(path);
        const storage = openStorage(collectionName);

        try {
          const nodeId = resolveNodeId(storage, name, filePath);
          if (!nodeId) {
            return {
              content: [
                {
                  type: "text",
                  text: `Symbol '${name}' not found in graph for codebase at "${path}". ` +
                    `Ensure the codebase is indexed with CODE_ENABLE_GRAPH=true.`,
                },
              ],
            };
          }

          const callees = storage.getCallees(nodeId);

          if (callees.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: `No direct callees found for '${name}'. This symbol makes no outgoing calls.`,
                },
              ],
            };
          }

          const lines: string[] = [
            `Direct callees of '${name}' (${callees.length}):`,
            "",
          ];
          callees.forEach((node, idx) => {
            lines.push(
              `${idx + 1}. ${node.name} [${node.nodeType}]`,
              `   File: ${node.filePath}:${node.startLine}-${node.endLine}`,
            );
          });

          return {
            content: [{ type: "text", text: lines.join("\n") }],
          };
        } finally {
          storage.close();
        }
      },
    ),
  );

  // get_shared_interfaces
  server.registerTool(
    "get_shared_interfaces",
    {
      title: "Get Shared Interfaces",
      description:
        "Finds interfaces and types referenced by both sets of files, identifying shared contracts between modules. " +
        "Use when exploring cross-boundary dependencies or planning API changes. " +
        "Trigger: 'what interfaces do A and B share?', 'shared contracts between modules', 'coupling points'",
      inputSchema: schemas.SharedInterfacesSchema,
    },
    withToolLogging(
      "get_shared_interfaces",
      async ({ path, filesA, filesB }) => {
        log.info(
          { tool: "get_shared_interfaces", path, filesACount: filesA.length, filesBCount: filesB.length },
          "Tool called",
        );

        if (!graphConfig.enabled) {
          return {
            content: [
              {
                type: "text",
                text: "Graph analysis is disabled. Set CODE_ENABLE_GRAPH=true to enable it.",
              },
            ],
          };
        }

        const collectionName = await collectionNameForPath(path);
        const storage = openStorage(collectionName);

        try {
          // Find interfaces/types referenced by files in BOTH sets
          const shared = storage.getSharedInterfacesBetween(filesA, filesB);

          if (shared.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: `No shared interfaces found between the specified file sets in codebase at "${path}".`,
                },
              ],
            };
          }

          const lines: string[] = [
            `Shared interfaces/types (${shared.length}):`,
            "",
          ];
          shared.forEach((node, idx) => {
            lines.push(
              `${idx + 1}. ${node.name} [${node.nodeType}]`,
              `   File: ${node.filePath}:${node.startLine}-${node.endLine}`,
            );
          });

          return {
            content: [{ type: "text", text: lines.join("\n") }],
          };
        } finally {
          storage.close();
        }
      },
    ),
  );
}
