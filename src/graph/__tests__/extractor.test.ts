import { describe, it, expect, beforeAll } from "vitest";
import {
  RelationshipExtractor,
  generateNodeId,
  isValidName,
} from "../extractor.js";
import type { ExtractionResult } from "../types.js";
import { UNRESOLVED_PREFIX } from "../types.js";

describe("generateNodeId", () => {
  it("should produce a 16-character hex string", () => {
    const id = generateNodeId("/src/index.ts", "myFunc", "function", 10);
    expect(id).toHaveLength(16);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("should be deterministic", () => {
    const id1 = generateNodeId("/src/a.ts", "foo", "function", 1);
    const id2 = generateNodeId("/src/a.ts", "foo", "function", 1);
    expect(id1).toBe(id2);
  });

  it("should differ for different inputs", () => {
    const id1 = generateNodeId("/src/a.ts", "foo", "function", 1);
    const id2 = generateNodeId("/src/a.ts", "foo", "function", 2);
    expect(id1).not.toBe(id2);
  });
});

describe("isValidName", () => {
  it("should accept valid names", () => {
    expect(isValidName("foo")).toBe(true);
    expect(isValidName("_bar")).toBe(true);
    expect(isValidName("$ref")).toBe(true);
    expect(isValidName("Foo.bar")).toBe(true);
  });

  it("should reject invalid names", () => {
    expect(isValidName("")).toBe(false);
    expect(isValidName("1bad")).toBe(false);
    expect(isValidName("foo bar")).toBe(false);
    expect(isValidName("foo-bar")).toBe(false);
  });
});

describe("RelationshipExtractor", () => {
  let extractor: RelationshipExtractor;

  beforeAll(() => {
    extractor = new RelationshipExtractor();
  });

  describe("supportsLanguage", () => {
    it("should support all 7 languages", () => {
      for (const lang of [
        "typescript",
        "javascript",
        "go",
        "python",
        "rust",
        "java",
        "bash",
      ]) {
        expect(extractor.supportsLanguage(lang)).toBe(true);
      }
    });

    it("should not support unsupported languages", () => {
      expect(extractor.supportsLanguage("ruby")).toBe(false);
      expect(extractor.supportsLanguage("c")).toBe(false);
    });
  });

  describe("unsupported language", () => {
    it("should return empty result for unsupported languages", () => {
      const result = extractor.extract("some code", "/file.rb", "ruby");
      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // TypeScript
  // -------------------------------------------------------------------------
  describe("TypeScript extraction", () => {
    it("should extract function declarations", () => {
      const code = `
function greet(name: string): string {
  return "Hello, " + name;
}
`;
      const result = extractor.extract(code, "/src/greet.ts", "typescript");
      const funcNode = result.nodes.find((n) => n.name === "greet");
      expect(funcNode).toBeDefined();
      expect(funcNode!.nodeType).toBe("function");
      expect(funcNode!.language).toBe("typescript");
    });

    it("should extract import statements", () => {
      const code = `import { foo } from "./foo";`;
      const result = extractor.extract(code, "/src/bar.ts", "typescript");
      const importEdge = result.edges.find(
        (e) => e.relationshipType === "imports",
      );
      expect(importEdge).toBeDefined();
      expect(importEdge!.targetId).toBe(`${UNRESOLVED_PREFIX}foo`);
    });

    it("should extract class declarations with extends", () => {
      const code = `
class Dog extends Animal {
  bark() { return "woof"; }
}
`;
      const result = extractor.extract(code, "/src/dog.ts", "typescript");
      const classNode = result.nodes.find((n) => n.name === "Dog");
      expect(classNode).toBeDefined();
      expect(classNode!.nodeType).toBe("class");

      const extendsEdge = result.edges.find(
        (e) => e.relationshipType === "extends",
      );
      expect(extendsEdge).toBeDefined();
      expect(extendsEdge!.targetId).toBe(`${UNRESOLVED_PREFIX}Animal`);
    });

    it("should extract interface declarations", () => {
      const code = `
interface Serializable {
  serialize(): string;
}
`;
      const result = extractor.extract(
        code,
        "/src/serializable.ts",
        "typescript",
      );
      const ifaceNode = result.nodes.find((n) => n.name === "Serializable");
      expect(ifaceNode).toBeDefined();
      expect(ifaceNode!.nodeType).toBe("interface");
    });

    it("should extract type alias declarations", () => {
      const code = `type ID = string | number;`;
      const result = extractor.extract(code, "/src/types.ts", "typescript");
      const typeNode = result.nodes.find((n) => n.name === "ID");
      expect(typeNode).toBeDefined();
      expect(typeNode!.nodeType).toBe("type");
    });

    it("should extract call expressions from functions", () => {
      const code = `
function main() {
  greet("world");
}
`;
      const result = extractor.extract(code, "/src/main.ts", "typescript");
      const callEdge = result.edges.find(
        (e) =>
          e.relationshipType === "calls" &&
          e.targetId === `${UNRESOLVED_PREFIX}greet`,
      );
      expect(callEdge).toBeDefined();
    });

    it("should skip names that fail validation", () => {
      // Names with invalid characters should be discarded
      const code = `
function valid_func() {}
`;
      const result = extractor.extract(code, "/src/test.ts", "typescript");
      // All extracted nodes should pass name validation
      for (const node of result.nodes) {
        if (node.nodeType !== "module") {
          expect(isValidName(node.name)).toBe(true);
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // JavaScript
  // -------------------------------------------------------------------------
  describe("JavaScript extraction", () => {
    it("should extract function declarations", () => {
      const code = `
function add(a, b) {
  return a + b;
}
`;
      const result = extractor.extract(code, "/src/math.js", "javascript");
      const funcNode = result.nodes.find((n) => n.name === "add");
      expect(funcNode).toBeDefined();
      expect(funcNode!.nodeType).toBe("function");
    });

    it("should extract import statements", () => {
      const code = `import { bar } from "./bar";`;
      const result = extractor.extract(code, "/src/foo.js", "javascript");
      const importEdge = result.edges.find(
        (e) => e.relationshipType === "imports",
      );
      expect(importEdge).toBeDefined();
    });

    it("should extract class with extends", () => {
      const code = `
class Cat extends Animal {
  meow() { return "meow"; }
}
`;
      const result = extractor.extract(code, "/src/cat.js", "javascript");
      const classNode = result.nodes.find((n) => n.name === "Cat");
      expect(classNode).toBeDefined();

      const extendsEdge = result.edges.find(
        (e) => e.relationshipType === "extends",
      );
      expect(extendsEdge).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Go
  // -------------------------------------------------------------------------
  describe("Go extraction", () => {
    it("should extract function declarations", () => {
      const code = `
package main

func greet(name string) string {
  return "Hello, " + name
}
`;
      const result = extractor.extract(code, "/src/greet.go", "go");
      const funcNode = result.nodes.find((n) => n.name === "greet");
      expect(funcNode).toBeDefined();
      expect(funcNode!.nodeType).toBe("function");
    });

    it("should extract import declarations", () => {
      const code = `
package main

import (
  "fmt"
  "os"
)
`;
      const result = extractor.extract(code, "/src/main.go", "go");
      const importEdges = result.edges.filter(
        (e) => e.relationshipType === "imports",
      );
      expect(importEdges.length).toBeGreaterThanOrEqual(1);
    });

    it("should extract method declarations with receiver", () => {
      const code = `
package main

type Server struct {}

func (s *Server) Start() error {
  return nil
}
`;
      const result = extractor.extract(code, "/src/server.go", "go");
      const methodNode = result.nodes.find((n) => n.name === "Server.Start");
      expect(methodNode).toBeDefined();
      expect(methodNode!.nodeType).toBe("method");
    });

    it("should extract type declarations", () => {
      const code = `
package main

type Config struct {
  Host string
  Port int
}
`;
      const result = extractor.extract(code, "/src/config.go", "go");
      const typeNode = result.nodes.find((n) => n.name === "Config");
      expect(typeNode).toBeDefined();
    });

    it("should extract interface type declarations", () => {
      const code = `
package main

type Reader interface {
  Read(p []byte) (n int, err error)
}
`;
      const result = extractor.extract(code, "/src/reader.go", "go");
      const ifaceNode = result.nodes.find((n) => n.name === "Reader");
      expect(ifaceNode).toBeDefined();
      expect(ifaceNode!.nodeType).toBe("interface");
    });
  });

  // -------------------------------------------------------------------------
  // Python
  // -------------------------------------------------------------------------
  describe("Python extraction", () => {
    it("should extract function definitions", () => {
      const code = `
def greet(name):
    return f"Hello, {name}"
`;
      const result = extractor.extract(code, "/src/greet.py", "python");
      const funcNode = result.nodes.find((n) => n.name === "greet");
      expect(funcNode).toBeDefined();
      expect(funcNode!.nodeType).toBe("function");
    });

    it("should extract import statements", () => {
      const code = `import os`;
      const result = extractor.extract(code, "/src/main.py", "python");
      const importEdge = result.edges.find(
        (e) => e.relationshipType === "imports",
      );
      expect(importEdge).toBeDefined();
    });

    it("should extract from-import statements", () => {
      const code = `from os import path`;
      const result = extractor.extract(code, "/src/main.py", "python");
      const importEdge = result.edges.find(
        (e) => e.relationshipType === "imports",
      );
      expect(importEdge).toBeDefined();
    });

    it("should extract class definitions with base classes", () => {
      const code = `
class Dog(Animal):
    def bark(self):
        return "woof"
`;
      const result = extractor.extract(code, "/src/dog.py", "python");
      const classNode = result.nodes.find((n) => n.name === "Dog");
      expect(classNode).toBeDefined();
      expect(classNode!.nodeType).toBe("class");

      const extendsEdge = result.edges.find(
        (e) => e.relationshipType === "extends",
      );
      expect(extendsEdge).toBeDefined();
      expect(extendsEdge!.targetId).toBe(`${UNRESOLVED_PREFIX}Animal`);
    });

    it("should extract function calls", () => {
      const code = `
def main():
    greet("world")
`;
      const result = extractor.extract(code, "/src/main.py", "python");
      const callEdge = result.edges.find(
        (e) =>
          e.relationshipType === "calls" &&
          e.targetId === `${UNRESOLVED_PREFIX}greet`,
      );
      expect(callEdge).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Rust
  // -------------------------------------------------------------------------
  describe("Rust extraction", () => {
    it("should extract function items", () => {
      const code = `
fn greet(name: &str) -> String {
    format!("Hello, {}", name)
}
`;
      const result = extractor.extract(code, "/src/greet.rs", "rust");
      const funcNode = result.nodes.find((n) => n.name === "greet");
      expect(funcNode).toBeDefined();
      expect(funcNode!.nodeType).toBe("function");
    });

    it("should extract use declarations", () => {
      const code = `use std::collections::HashMap;`;
      const result = extractor.extract(code, "/src/lib.rs", "rust");
      const importEdge = result.edges.find(
        (e) => e.relationshipType === "imports",
      );
      expect(importEdge).toBeDefined();
    });

    it("should extract struct items", () => {
      const code = `
struct Config {
    host: String,
    port: u16,
}
`;
      const result = extractor.extract(code, "/src/config.rs", "rust");
      const structNode = result.nodes.find((n) => n.name === "Config");
      expect(structNode).toBeDefined();
      expect(structNode!.nodeType).toBe("type");
    });

    it("should extract trait items", () => {
      const code = `
trait Serializable {
    fn serialize(&self) -> String;
}
`;
      const result = extractor.extract(code, "/src/traits.rs", "rust");
      const traitNode = result.nodes.find((n) => n.name === "Serializable");
      expect(traitNode).toBeDefined();
      expect(traitNode!.nodeType).toBe("interface");
    });

    it("should extract impl with trait", () => {
      const code = `
impl Display for Config {
    fn fmt(&self, f: &mut Formatter) -> Result {
        write!(f, "{}:{}", self.host, self.port)
    }
}
`;
      const result = extractor.extract(code, "/src/config.rs", "rust");
      const implEdge = result.edges.find(
        (e) => e.relationshipType === "implements",
      );
      expect(implEdge).toBeDefined();
      expect(implEdge!.targetId).toBe(`${UNRESOLVED_PREFIX}Display`);
    });
  });

  // -------------------------------------------------------------------------
  // Java
  // -------------------------------------------------------------------------
  describe("Java extraction", () => {
    it("should extract class declarations", () => {
      const code = `
public class Dog extends Animal implements Serializable {
    public void bark() {
        System.out.println("woof");
    }
}
`;
      const result = extractor.extract(code, "/src/Dog.java", "java");
      const classNode = result.nodes.find((n) => n.name === "Dog");
      expect(classNode).toBeDefined();
      expect(classNode!.nodeType).toBe("class");

      const extendsEdge = result.edges.find(
        (e) => e.relationshipType === "extends",
      );
      expect(extendsEdge).toBeDefined();
      expect(extendsEdge!.targetId).toBe(`${UNRESOLVED_PREFIX}Animal`);

      const implEdge = result.edges.find(
        (e) => e.relationshipType === "implements",
      );
      expect(implEdge).toBeDefined();
      expect(implEdge!.targetId).toBe(`${UNRESOLVED_PREFIX}Serializable`);
    });

    it("should extract import declarations", () => {
      const code = `
import java.util.HashMap;
`;
      const result = extractor.extract(code, "/src/Main.java", "java");
      const importEdge = result.edges.find(
        (e) => e.relationshipType === "imports",
      );
      expect(importEdge).toBeDefined();
      expect(importEdge!.targetId).toBe(`${UNRESOLVED_PREFIX}HashMap`);
    });

    it("should extract method declarations", () => {
      const code = `
public class Calculator {
    public int add(int a, int b) {
        return a + b;
    }
}
`;
      const result = extractor.extract(
        code,
        "/src/Calculator.java",
        "java",
      );
      const methodNode = result.nodes.find((n) => n.name === "add");
      expect(methodNode).toBeDefined();
      expect(methodNode!.nodeType).toBe("method");
    });

    it("should extract method invocations", () => {
      const code = `
public class Main {
    public void run() {
        helper.process();
    }
}
`;
      const result = extractor.extract(code, "/src/Main.java", "java");
      const callEdge = result.edges.find(
        (e) =>
          e.relationshipType === "calls" &&
          e.targetId === `${UNRESOLVED_PREFIX}process`,
      );
      expect(callEdge).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Bash
  // -------------------------------------------------------------------------
  describe("Bash extraction", () => {
    it("should extract function definitions", () => {
      const code = `
greet() {
  echo "Hello, $1"
}
`;
      const result = extractor.extract(code, "/scripts/greet.sh", "bash");
      const funcNode = result.nodes.find((n) => n.name === "greet");
      expect(funcNode).toBeDefined();
      expect(funcNode!.nodeType).toBe("function");
    });

    it("should extract source commands as imports", () => {
      const code = `source ./lib/utils.sh`;
      const result = extractor.extract(code, "/scripts/main.sh", "bash");
      const importEdge = result.edges.find(
        (e) => e.relationshipType === "imports",
      );
      expect(importEdge).toBeDefined();
    });

    it("should extract function calls within functions", () => {
      const code = `
greet() {
  echo "Hello"
}

main() {
  greet
}
`;
      const result = extractor.extract(code, "/scripts/test.sh", "bash");
      const callEdge = result.edges.find(
        (e) =>
          e.relationshipType === "calls" &&
          e.targetId === `${UNRESOLVED_PREFIX}greet`,
      );
      expect(callEdge).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Cross-cutting concerns
  // -------------------------------------------------------------------------
  describe("Cross-cutting", () => {
    it("should create module nodes for files with imports", () => {
      const code = `import { foo } from "./foo";`;
      const result = extractor.extract(code, "/src/bar.ts", "typescript");
      const moduleNode = result.nodes.find((n) => n.nodeType === "module");
      expect(moduleNode).toBeDefined();
      expect(moduleNode!.filePath).toBe("/src/bar.ts");
    });

    it("should produce deterministic node IDs", () => {
      const code = `function hello() { return "hi"; }`;
      const r1 = extractor.extract(code, "/src/a.ts", "typescript");
      const r2 = extractor.extract(code, "/src/a.ts", "typescript");
      const n1 = r1.nodes.find((n) => n.name === "hello");
      const n2 = r2.nodes.find((n) => n.name === "hello");
      expect(n1!.id).toBe(n2!.id);
    });

    it("should handle empty code gracefully", () => {
      const result = extractor.extract("", "/src/empty.ts", "typescript");
      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
    });

    it("should set filePath and language in result", () => {
      const result = extractor.extract(
        "function f() {}",
        "/src/test.ts",
        "typescript",
      );
      expect(result.filePath).toBe("/src/test.ts");
      expect(result.language).toBe("typescript");
    });
  });
});
