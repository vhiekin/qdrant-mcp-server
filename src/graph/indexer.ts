/**
 * GraphIndexer — orchestrates relationship extraction and storage for a codebase.
 *
 * Wraps RelationshipExtractor + GraphStorage and exposes a simple API for
 * full index, incremental update, clear, and stats.
 */

import { unlinkSync } from "node:fs";
import logger from "../logger.js";
import { RelationshipExtractor } from "./extractor.js";
import { GraphStorage } from "./storage.js";
import type { GraphConfig, GraphStats } from "./types.js";

const log = logger.child({ component: "graph-indexer" });

export interface FileInput {
  path: string;
  content: string;
  language: string;
}

export class GraphIndexer {
  private extractor: RelationshipExtractor;

  constructor(private config: GraphConfig) {
    this.extractor = new RelationshipExtractor();
  }

  /**
   * Full index: extract and store relationships for a set of files.
   * Replaces any existing data for those files in the named graph DB.
   */
  indexFiles(files: FileInput[], collectionName: string): void {
    if (!this.config.enabled) {
      log.debug({ collectionName }, "Graph indexing disabled, skipping");
      return;
    }

    const dbPath = GraphStorage.defaultPath(collectionName);
    const storage = new GraphStorage(dbPath);

    try {
      let nodesTotal = 0;
      let edgesTotal = 0;

      for (const file of files) {
        if (!this.extractor.supportsLanguage(file.language)) {
          continue;
        }

        try {
          const result = this.extractor.extract(
            file.content,
            file.path,
            file.language,
          );

          if (result.nodes.length > 0) {
            storage.insertNodes(result.nodes);
            nodesTotal += result.nodes.length;
          }
          if (result.edges.length > 0) {
            storage.insertEdges(result.edges);
            edgesTotal += result.edges.length;
          }
        } catch (error) {
          log.warn(
            { filePath: file.path, err: error },
            "Failed to extract relationships from file, skipping",
          );
        }
      }

      // Cross-file resolution: match unresolved targets to actual nodes
      const resolved = storage.resolveEdges();

      log.info(
        {
          collectionName,
          nodesTotal,
          edgesTotal,
          resolvedEdges: resolved,
          fileCount: files.length,
        },
        "Graph index complete",
      );
    } finally {
      storage.close();
    }
  }

  /**
   * Incremental update: remove old data for deleted/modified files, then
   * re-extract and insert for added/modified files.
   */
  updateFiles(
    added: FileInput[],
    modified: FileInput[],
    deleted: string[],
    collectionName: string,
  ): void {
    if (!this.config.enabled) {
      log.debug({ collectionName }, "Graph indexing disabled, skipping");
      return;
    }

    const dbPath = GraphStorage.defaultPath(collectionName);
    const storage = new GraphStorage(dbPath);

    try {
      // Delete stale data for modified and deleted files
      const filesToDelete = [
        ...deleted,
        ...modified.map((f) => f.path),
      ];
      if (filesToDelete.length > 0) {
        storage.deleteByFiles(filesToDelete);
      }

      // Re-index added and modified files
      const filesToIndex = [...added, ...modified];
      let nodesTotal = 0;
      let edgesTotal = 0;

      for (const file of filesToIndex) {
        if (!this.extractor.supportsLanguage(file.language)) {
          continue;
        }

        try {
          const result = this.extractor.extract(
            file.content,
            file.path,
            file.language,
          );

          if (result.nodes.length > 0) {
            storage.insertNodes(result.nodes);
            nodesTotal += result.nodes.length;
          }
          if (result.edges.length > 0) {
            storage.insertEdges(result.edges);
            edgesTotal += result.edges.length;
          }
        } catch (error) {
          log.warn(
            { filePath: file.path, err: error },
            "Failed to extract relationships from file during update, skipping",
          );
        }
      }

      // Re-resolve edges (new nodes may satisfy previously unresolved targets)
      const resolved = storage.resolveEdges();

      log.info(
        {
          collectionName,
          nodesTotal,
          edgesTotal,
          resolvedEdges: resolved,
          addedCount: added.length,
          modifiedCount: modified.length,
          deletedCount: deleted.length,
        },
        "Graph incremental update complete",
      );
    } finally {
      storage.close();
    }
  }

  /**
   * Destroy the graph DB for a collection.
   * No-op if the DB doesn't exist.
   */
  clearGraph(collectionName: string): void {
    const dbPath = GraphStorage.defaultPath(collectionName);

    // Delete the DB file
    try {
      unlinkSync(dbPath);
      log.info({ collectionName, dbPath }, "Graph DB cleared");
    } catch (error: any) {
      if (error?.code !== "ENOENT") {
        log.warn({ collectionName, dbPath, err: error }, "Failed to delete graph DB file");
      }
    }
  }

  /**
   * Query graph statistics for a collection.
   * Returns null if the DB doesn't exist or graph is disabled.
   */
  getStats(collectionName: string): GraphStats | null {
    if (!this.config.enabled) {
      return null;
    }

    const dbPath = GraphStorage.defaultPath(collectionName);
    let storage: GraphStorage;

    try {
      storage = new GraphStorage(dbPath);
    } catch {
      return null;
    }

    try {
      return storage.getStats();
    } finally {
      storage.close();
    }
  }
}
