import { describe, it, expect } from "vitest";
import { parseGraphConfig } from "../config.js";

describe("parseGraphConfig", () => {
  it("should return defaults when no env vars are set", () => {
    const config = parseGraphConfig({});
    expect(config.enabled).toBe(true);
    expect(config.maxDepth).toBe(10);
  });

  it("should parse CODE_ENABLE_GRAPH=false", () => {
    const config = parseGraphConfig({ CODE_ENABLE_GRAPH: "false" });
    expect(config.enabled).toBe(false);
  });

  it("should parse CODE_ENABLE_GRAPH=true", () => {
    const config = parseGraphConfig({ CODE_ENABLE_GRAPH: "true" });
    expect(config.enabled).toBe(true);
  });

  it("should treat CODE_ENABLE_GRAPH=False (mixed case) as false", () => {
    const config = parseGraphConfig({ CODE_ENABLE_GRAPH: "False" });
    expect(config.enabled).toBe(false);
  });

  it("should treat CODE_ENABLE_GRAPH=0 as truthy (only 'false' disables)", () => {
    const config = parseGraphConfig({ CODE_ENABLE_GRAPH: "0" });
    expect(config.enabled).toBe(true);
  });

  it("should parse CODE_GRAPH_MAX_DEPTH as integer", () => {
    const config = parseGraphConfig({ CODE_GRAPH_MAX_DEPTH: "5" });
    expect(config.maxDepth).toBe(5);
  });

  it("should use default maxDepth for invalid values", () => {
    const config = parseGraphConfig({ CODE_GRAPH_MAX_DEPTH: "abc" });
    expect(config.maxDepth).toBe(10);
  });

  it("should use default maxDepth for zero", () => {
    const config = parseGraphConfig({ CODE_GRAPH_MAX_DEPTH: "0" });
    expect(config.maxDepth).toBe(10);
  });

  it("should use default maxDepth for negative values", () => {
    const config = parseGraphConfig({ CODE_GRAPH_MAX_DEPTH: "-3" });
    expect(config.maxDepth).toBe(10);
  });

  it("should parse both env vars together", () => {
    const config = parseGraphConfig({
      CODE_ENABLE_GRAPH: "false",
      CODE_GRAPH_MAX_DEPTH: "20",
    });
    expect(config.enabled).toBe(false);
    expect(config.maxDepth).toBe(20);
  });

  it("should ignore unrelated env vars", () => {
    const config = parseGraphConfig({
      SOME_OTHER_VAR: "hello",
      CODE_ENABLE_GRAPH: "true",
    });
    expect(config.enabled).toBe(true);
    expect(config.maxDepth).toBe(10);
  });
});
