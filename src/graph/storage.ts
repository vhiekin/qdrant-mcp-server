/**
 * SQLite-backed graph storage using better-sqlite3.
 *
 * Stores nodes and edges in an embedded SQLite database, providing
 * single-hop queries, multi-hop traversal, and aggregate statistics.
 *
 * All queries use parameterized statements. No string interpolation in SQL.
 */

import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdirSync } from "node:fs";

import logger from "../logger.js";
import type {
  GraphNode,
  GraphEdge,
  GraphStats,
  CallChain,
  ImpactResult,
  RelationshipType,
} from "./types.js";

const log = logger.child({ component: "graph-storage" });

/**
 * GraphStorage manages the SQLite database for code graph data.
 *
 * DB path: `~/.qdrant-mcp/graph/{collectionName}.db`
 * For tests, pass `:memory:` as the path.
 */
export class GraphStorage {
  private db: DatabaseType;

  /**
   * @param dbPath — Full path to SQLite DB file, or `:memory:` for tests.
   */
  constructor(dbPath: string) {
    if (dbPath !== ":memory:") {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.initSchema();
  }

  /**
   * Build the default DB path for a collection.
   */
  static defaultPath(collectionName: string): string {
    return join(homedir(), ".qdrant-mcp", "graph", `${collectionName}.db`);
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }

  // ---------------------------------------------------------------------------
  // Schema
  // ---------------------------------------------------------------------------
  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        node_type   TEXT NOT NULL,
        file_path   TEXT NOT NULL,
        start_line  INTEGER NOT NULL,
        end_line    INTEGER NOT NULL,
        language    TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS edges (
        source_id         TEXT NOT NULL,
        target_id         TEXT NOT NULL,
        relationship_type TEXT NOT NULL,
        source_file       TEXT NOT NULL,
        target_file       TEXT,
        PRIMARY KEY (source_id, target_id, relationship_type)
      );

      CREATE INDEX IF NOT EXISTS idx_nodes_file_path ON nodes(file_path);
      CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);
      CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
      CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
      CREATE INDEX IF NOT EXISTS idx_edges_source_file ON edges(source_file);
      CREATE INDEX IF NOT EXISTS idx_edges_rel_type ON edges(relationship_type);
    `);
  }

  // ---------------------------------------------------------------------------
  // Write operations
  // ---------------------------------------------------------------------------

  /**
   * Insert or replace nodes. Runs in a transaction.
   */
  insertNodes(nodes: GraphNode[]): void {
    if (nodes.length === 0) return;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO nodes (id, name, node_type, file_path, start_line, end_line, language)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((items: GraphNode[]) => {
      for (const n of items) {
        stmt.run(
          n.id,
          n.name,
          n.nodeType,
          n.filePath,
          n.startLine,
          n.endLine,
          n.language,
        );
      }
    });

    insertMany(nodes);
    log.debug({ count: nodes.length }, "Inserted nodes");
  }

  /**
   * Insert or ignore edges. Runs in a transaction.
   */
  insertEdges(edges: GraphEdge[]): void {
    if (edges.length === 0) return;

    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO edges (source_id, target_id, relationship_type, source_file, target_file)
      VALUES (?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((items: GraphEdge[]) => {
      for (const e of items) {
        stmt.run(
          e.sourceId,
          e.targetId,
          e.relationshipType,
          e.sourceFile,
          e.targetFile,
        );
      }
    });

    insertMany(edges);
    log.debug({ count: edges.length }, "Inserted edges");
  }

  /**
   * Delete all nodes and edges associated with the given file paths.
   * Used for incremental re-indexing.
   */
  deleteByFiles(filePaths: string[]): void {
    if (filePaths.length === 0) return;

    const deleteNodesByFile = this.db.prepare(
      "DELETE FROM nodes WHERE file_path = ?",
    );
    const deleteEdgesBySourceFile = this.db.prepare(
      "DELETE FROM edges WHERE source_file = ?",
    );

    const deleteMany = this.db.transaction((paths: string[]) => {
      for (const p of paths) {
        deleteNodesByFile.run(p);
        deleteEdgesBySourceFile.run(p);
      }
    });

    deleteMany(filePaths);
    log.debug({ count: filePaths.length }, "Deleted data for files");
  }

  // ---------------------------------------------------------------------------
  // Single-hop queries
  // ---------------------------------------------------------------------------

  /**
   * Get a single node by ID.
   */
  getNode(nodeId: string): GraphNode | undefined {
    const row = this.db
      .prepare("SELECT * FROM nodes WHERE id = ?")
      .get(nodeId) as any;
    return row ? this.rowToNode(row) : undefined;
  }

  /**
   * Get all nodes in a file.
   */
  getNodesByFile(filePath: string): GraphNode[] {
    const rows = this.db
      .prepare("SELECT * FROM nodes WHERE file_path = ?")
      .all(filePath) as any[];
    return rows.map(this.rowToNode);
  }

  /**
   * Get nodes that call the given node (incoming "calls" edges).
   */
  getCallers(nodeId: string): GraphNode[] {
    const rows = this.db
      .prepare(
        `SELECT n.* FROM nodes n
         JOIN edges e ON n.id = e.source_id
         WHERE e.target_id = ? AND e.relationship_type = 'calls'`,
      )
      .all(nodeId) as any[];
    return rows.map(this.rowToNode);
  }

  /**
   * Get nodes that the given node calls (outgoing "calls" edges).
   */
  getCallees(nodeId: string): GraphNode[] {
    const rows = this.db
      .prepare(
        `SELECT n.* FROM nodes n
         JOIN edges e ON n.id = e.target_id
         WHERE e.source_id = ? AND e.relationship_type = 'calls'`,
      )
      .all(nodeId) as any[];
    return rows.map(this.rowToNode);
  }

  /**
   * Get all edges originating from a node.
   */
  getOutgoingEdges(nodeId: string): GraphEdge[] {
    const rows = this.db
      .prepare("SELECT * FROM edges WHERE source_id = ?")
      .all(nodeId) as any[];
    return rows.map(this.rowToEdge);
  }

  /**
   * Get all edges targeting a node.
   */
  getIncomingEdges(nodeId: string): GraphEdge[] {
    const rows = this.db
      .prepare("SELECT * FROM edges WHERE target_id = ?")
      .all(nodeId) as any[];
    return rows.map(this.rowToEdge);
  }

  // ---------------------------------------------------------------------------
  // Multi-hop traversal
  // ---------------------------------------------------------------------------

  /**
   * Trace the call chain starting from a node, up to maxDepth hops.
   * Uses application-side Set<string> for cycle prevention.
   */
  traceCallChain(startNodeId: string, maxDepth: number): CallChain {
    const visited = new Set<string>();
    const nodeIds: string[] = [];
    const graphNodes: GraphNode[] = [];

    const queue: Array<{ nodeId: string; depth: number }> = [
      { nodeId: startNodeId, depth: 0 },
    ];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current.nodeId)) continue;
      if (current.depth > maxDepth) continue;

      visited.add(current.nodeId);
      nodeIds.push(current.nodeId);

      const node = this.getNode(current.nodeId);
      if (node) {
        graphNodes.push(node);
      }

      // Get all callees
      const calleeEdges = this.db
        .prepare(
          "SELECT target_id FROM edges WHERE source_id = ? AND relationship_type = 'calls'",
        )
        .all(current.nodeId) as any[];

      for (const row of calleeEdges) {
        if (!visited.has(row.target_id)) {
          queue.push({ nodeId: row.target_id, depth: current.depth + 1 });
        }
      }
    }

    return {
      nodeIds,
      nodes: graphNodes,
      depth: Math.max(0, nodeIds.length - 1),
    };
  }

  /**
   * Get the impact radius of a node — all nodes reachable via incoming edges
   * (who calls this, who calls those callers, etc.) up to maxDepth.
   */
  getImpactRadius(nodeId: string, maxDepth: number): ImpactResult {
    const visited = new Set<string>();
    const impactedNodes: GraphNode[] = [];
    const impactedEdges: GraphEdge[] = [];
    let actualMaxDepth = 0;

    const queue: Array<{ nodeId: string; depth: number }> = [
      { nodeId, depth: 0 },
    ];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current.nodeId)) continue;
      if (current.depth > maxDepth) continue;

      visited.add(current.nodeId);
      if (current.depth > actualMaxDepth) {
        actualMaxDepth = current.depth;
      }

      const node = this.getNode(current.nodeId);
      if (node) {
        impactedNodes.push(node);
      }

      // Get all callers (incoming "calls" edges)
      const callerEdges = this.db
        .prepare(
          "SELECT * FROM edges WHERE target_id = ? AND relationship_type = 'calls'",
        )
        .all(current.nodeId) as any[];

      for (const row of callerEdges) {
        impactedEdges.push(this.rowToEdge(row));
        if (!visited.has(row.source_id)) {
          queue.push({ nodeId: row.source_id, depth: current.depth + 1 });
        }
      }
    }

    return {
      rootNodeId: nodeId,
      impactedNodes,
      impactedEdges,
      maxDepth: actualMaxDepth,
    };
  }

  // ---------------------------------------------------------------------------
  // Aggregate queries
  // ---------------------------------------------------------------------------

  /**
   * Get nodes that appear in multiple files (shared interfaces, etc.).
   */
  getSharedInterfaces(): GraphNode[] {
    const rows = this.db
      .prepare(
        `SELECT n.* FROM nodes n
         WHERE n.node_type IN ('interface', 'type')
         AND (SELECT COUNT(DISTINCT e.source_file) FROM edges e WHERE e.target_id = n.id) > 1`,
      )
      .all() as any[];
    return rows.map(this.rowToNode);
  }

  /**
   * Get overall graph statistics.
   */
  getStats(): GraphStats {
    const nodeCount = (
      this.db.prepare("SELECT COUNT(*) as count FROM nodes").get() as any
    ).count;
    const edgeCount = (
      this.db.prepare("SELECT COUNT(*) as count FROM edges").get() as any
    ).count;
    const fileCount = (
      this.db
        .prepare("SELECT COUNT(DISTINCT file_path) as count FROM nodes")
        .get() as any
    ).count;

    const relCounts = this.db
      .prepare(
        "SELECT relationship_type, COUNT(*) as count FROM edges GROUP BY relationship_type",
      )
      .all() as any[];

    const relationshipCounts: Record<RelationshipType, number> = {
      calls: 0,
      imports: 0,
      extends: 0,
      implements: 0,
      uses_type: 0,
    };

    for (const row of relCounts) {
      if (row.relationship_type in relationshipCounts) {
        relationshipCounts[row.relationship_type as RelationshipType] =
          row.count;
      }
    }

    return { nodeCount, edgeCount, fileCount, relationshipCounts };
  }

  /**
   * Get all distinct file pairs from edges (for cluster analysis).
   * Returns pairs of (source_file, target_file) where target_file is not null.
   * Enforces a scale guard at maxPairs.
   */
  getFilePairs(maxPairs: number = 50000): Array<[string, string]> {
    const count = (
      this.db
        .prepare(
          "SELECT COUNT(*) as count FROM (SELECT DISTINCT source_file, target_file FROM edges WHERE target_file IS NOT NULL)",
        )
        .get() as any
    ).count;

    if (count > maxPairs) {
      throw new Error(
        `File pair count (${count}) exceeds scale guard (${maxPairs}). Graph too large for cluster analysis.`,
      );
    }

    const rows = this.db
      .prepare(
        "SELECT DISTINCT source_file, target_file FROM edges WHERE target_file IS NOT NULL",
      )
      .all() as any[];

    return rows.map((r) => [r.source_file, r.target_file]);
  }

  // ---------------------------------------------------------------------------
  // Row mappers
  // ---------------------------------------------------------------------------
  private rowToNode(row: any): GraphNode {
    return {
      id: row.id,
      name: row.name,
      nodeType: row.node_type,
      filePath: row.file_path,
      startLine: row.start_line,
      endLine: row.end_line,
      language: row.language,
    };
  }

  private rowToEdge(row: any): GraphEdge {
    return {
      sourceId: row.source_id,
      targetId: row.target_id,
      relationshipType: row.relationship_type,
      sourceFile: row.source_file,
      targetFile: row.target_file,
    };
  }
}
