/**
 * Dependency Cluster Analyzer
 *
 * Detects clusters of tightly-connected files using connected-components
 * analysis on the file-adjacency graph extracted from edges.
 */

import logger from "../logger.js";
import type { GraphStorage } from "./storage.js";
import type { Cluster } from "./types.js";

const log = logger.child({ component: "graph-clusters" });

/** Maximum number of file pairs before refusing to analyze (scale guard) */
const MAX_FILE_PAIRS = 50_000;

/**
 * DependencyClusterAnalyzer finds connected components in the file-level
 * dependency graph. Two files are "connected" if there is any edge between them.
 */
export class DependencyClusterAnalyzer {
  constructor(private storage: GraphStorage) {}

  /**
   * Compute dependency clusters from the file-level graph.
   *
   * Algorithm:
   * 1. Fetch distinct (source_file, target_file) pairs from edges
   * 2. Build an undirected adjacency list
   * 3. BFS to find connected components
   * 4. Count internal edges per cluster
   *
   * Scale guard: throws if file pair count exceeds MAX_FILE_PAIRS.
   */
  analyze(): Cluster[] {
    const filePairs = this.storage.getFilePairs(MAX_FILE_PAIRS);

    if (filePairs.length === 0) {
      return [];
    }

    // Build undirected adjacency list
    const adjacency = new Map<string, Set<string>>();

    const addEdge = (a: string, b: string) => {
      if (!adjacency.has(a)) adjacency.set(a, new Set());
      if (!adjacency.has(b)) adjacency.set(b, new Set());
      adjacency.get(a)!.add(b);
      adjacency.get(b)!.add(a);
    };

    // Track directed pairs for edge counting
    const directedPairs = new Set<string>();

    for (const [source, target] of filePairs) {
      addEdge(source, target);
      directedPairs.add(`${source}\0${target}`);
    }

    // BFS to find connected components
    const visited = new Set<string>();
    const clusters: Cluster[] = [];
    let clusterId = 0;

    for (const file of adjacency.keys()) {
      if (visited.has(file)) continue;

      const component: string[] = [];
      const queue: string[] = [file];

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);
        component.push(current);

        const neighbors = adjacency.get(current);
        if (neighbors) {
          for (const neighbor of neighbors) {
            if (!visited.has(neighbor)) {
              queue.push(neighbor);
            }
          }
        }
      }

      // Count internal edges for this cluster
      let internalEdgeCount = 0;
      const componentSet = new Set(component);
      for (const pair of directedPairs) {
        const [source, target] = pair.split("\0");
        if (componentSet.has(source) && componentSet.has(target)) {
          internalEdgeCount++;
        }
      }

      clusters.push({
        id: clusterId++,
        files: component.sort(),
        internalEdgeCount,
      });
    }

    log.debug(
      { clusterCount: clusters.length, fileCount: adjacency.size },
      "Cluster analysis complete",
    );

    return clusters;
  }
}
