/**
 * Configuration parsing for the graph module.
 *
 * Reads environment variables and provides defaults.
 */

import type { GraphConfig } from "./types.js";

/** Default configuration values */
const DEFAULTS: GraphConfig = {
  enabled: true,
  maxDepth: 10,
};

/**
 * Parse graph configuration from environment variables.
 *
 * Env vars:
 * - `CODE_ENABLE_GRAPH` — "true" or "false" (default: true)
 * - `CODE_GRAPH_MAX_DEPTH` — integer >= 1 (default: 10)
 */
export function parseGraphConfig(
  env: Record<string, string | undefined> = process.env,
): GraphConfig {
  const enabledRaw = env.CODE_ENABLE_GRAPH;
  const maxDepthRaw = env.CODE_GRAPH_MAX_DEPTH;

  let enabled = DEFAULTS.enabled;
  if (enabledRaw !== undefined) {
    enabled = enabledRaw.toLowerCase() !== "false";
  }

  let maxDepth = DEFAULTS.maxDepth;
  if (maxDepthRaw !== undefined) {
    const parsed = parseInt(maxDepthRaw, 10);
    if (!Number.isNaN(parsed) && parsed >= 1) {
      maxDepth = parsed;
    }
  }

  return { enabled, maxDepth };
}
