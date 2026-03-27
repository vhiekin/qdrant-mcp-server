/**
 * Type definitions for the code graph module.
 *
 * Represents relationships between code symbols (functions, classes, modules)
 * extracted from ASTs and stored in an embedded SQLite database.
 */

/** Relationship types between code symbols */
export type RelationshipType =
  | "calls"
  | "imports"
  | "extends"
  | "implements"
  | "uses_type";

/** Node types representing code symbols */
export type NodeType =
  | "function"
  | "method"
  | "class"
  | "interface"
  | "module"
  | "type"
  | "variable";

/**
 * A node in the code graph representing a code symbol.
 */
export interface GraphNode {
  /** Deterministic ID: first 16 chars of SHA256(filePath:name:nodeType:startLine) */
  id: string;
  /** Symbol name (e.g., function name, class name) */
  name: string;
  /** Type of the symbol */
  nodeType: NodeType;
  /** Absolute file path */
  filePath: string;
  /** 1-based start line */
  startLine: number;
  /** 1-based end line */
  endLine: number;
  /** Programming language */
  language: string;
}

/**
 * An edge in the code graph representing a relationship between two symbols.
 */
export interface GraphEdge {
  /** ID of the source node */
  sourceId: string;
  /** ID of the target node (or `unresolved:{name}` for external deps) */
  targetId: string;
  /** Type of relationship */
  relationshipType: RelationshipType;
  /** File where the relationship was found */
  sourceFile: string;
  /** File of the target (if resolved) */
  targetFile: string | null;
}

/**
 * Statistics about the graph database.
 */
export interface GraphStats {
  /** Total number of nodes */
  nodeCount: number;
  /** Total number of edges */
  edgeCount: number;
  /** Number of distinct files */
  fileCount: number;
  /** Counts per relationship type */
  relationshipCounts: Record<RelationshipType, number>;
}

/**
 * A call chain from multi-hop traversal.
 */
export interface CallChain {
  /** Ordered list of node IDs from source to target */
  nodeIds: string[];
  /** Ordered list of nodes from source to target */
  nodes: GraphNode[];
  /** Depth of the chain */
  depth: number;
}

/**
 * Result of an impact radius analysis.
 */
export interface ImpactResult {
  /** The root node being analyzed */
  rootNodeId: string;
  /** All nodes within the impact radius */
  impactedNodes: GraphNode[];
  /** All edges within the impact radius */
  impactedEdges: GraphEdge[];
  /** Maximum depth reached */
  maxDepth: number;
}

/**
 * A cluster of tightly-connected files.
 */
export interface Cluster {
  /** Cluster identifier */
  id: number;
  /** File paths in this cluster */
  files: string[];
  /** Number of internal edges */
  internalEdgeCount: number;
}

/**
 * A node shared across multiple clusters.
 */
export interface SharedNode {
  /** The shared node */
  node: GraphNode;
  /** Cluster IDs this node appears in */
  clusterIds: number[];
}

/**
 * Configuration for the graph module.
 */
export interface GraphConfig {
  /** Whether graph extraction is enabled */
  enabled: boolean;
  /** Maximum depth for multi-hop traversal */
  maxDepth: number;
}

/**
 * Result of extracting relationships from a single file.
 */
export interface ExtractionResult {
  /** Nodes found in the file */
  nodes: GraphNode[];
  /** Edges (relationships) found in the file */
  edges: GraphEdge[];
  /** File path that was analyzed */
  filePath: string;
  /** Language of the file */
  language: string;
}

/** Regex for validating symbol names before storage */
export const NAME_VALIDATION_REGEX = /^[a-zA-Z_$][a-zA-Z0-9_$.*]*$/;

/** Prefix for unresolved external dependency target IDs */
export const UNRESOLVED_PREFIX = "unresolved:";
