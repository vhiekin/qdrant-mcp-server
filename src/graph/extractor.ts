/**
 * AST Relationship Extractor
 *
 * Extracts `calls`, `imports`, `extends`, `implements`, and `uses_type`
 * relationships from tree-sitter ASTs for 7 languages.
 */

import { createHash } from "node:crypto";
import Parser from "tree-sitter";
import Bash from "tree-sitter-bash";
import Go from "tree-sitter-go";
import Java from "tree-sitter-java";
import JavaScript from "tree-sitter-javascript";
import Python from "tree-sitter-python";
import Rust from "tree-sitter-rust";
import TypeScript from "tree-sitter-typescript";

import logger from "../logger.js";
import type {
  ExtractionResult,
  GraphEdge,
  GraphNode,
  NodeType,
  RelationshipType,
} from "./types.js";
import { NAME_VALIDATION_REGEX, UNRESOLVED_PREFIX } from "./types.js";

const log = logger.child({ component: "graph-extractor" });

/** Supported languages for relationship extraction */
const SUPPORTED_LANGUAGES = [
  "typescript",
  "javascript",
  "go",
  "python",
  "rust",
  "java",
  "bash",
] as const;

type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/**
 * Generate a deterministic node ID from its attributes.
 * Returns first 16 chars of SHA256 hash.
 */
export function generateNodeId(
  filePath: string,
  name: string,
  nodeType: NodeType,
  startLine: number,
): string {
  const input = `${filePath}:${name}:${nodeType}:${startLine}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

/**
 * Validate a symbol name against the naming regex.
 */
export function isValidName(name: string): boolean {
  return NAME_VALIDATION_REGEX.test(name);
}

/**
 * RelationshipExtractor uses tree-sitter to parse source code and extract
 * structural relationships between code symbols.
 */
export class RelationshipExtractor {
  private parsers: Map<string, Parser> = new Map();

  constructor() {
    this.initializeParsers();
  }

  private initializeParsers(): void {
    const tsParser = new Parser();
    tsParser.setLanguage(TypeScript.typescript as any);
    this.parsers.set("typescript", tsParser);

    const jsParser = new Parser();
    jsParser.setLanguage(JavaScript as any);
    this.parsers.set("javascript", jsParser);

    const goParser = new Parser();
    goParser.setLanguage(Go as any);
    this.parsers.set("go", goParser);

    const pyParser = new Parser();
    pyParser.setLanguage(Python as any);
    this.parsers.set("python", pyParser);

    const rustParser = new Parser();
    rustParser.setLanguage(Rust as any);
    this.parsers.set("rust", rustParser);

    const javaParser = new Parser();
    javaParser.setLanguage(Java as any);
    this.parsers.set("java", javaParser);

    const bashParser = new Parser();
    bashParser.setLanguage(Bash as any);
    this.parsers.set("bash", bashParser);
  }

  /**
   * Check if a language is supported for extraction.
   */
  supportsLanguage(language: string): boolean {
    return SUPPORTED_LANGUAGES.includes(language as SupportedLanguage);
  }

  /**
   * Extract relationships from a source file.
   */
  extract(code: string, filePath: string, language: string): ExtractionResult {
    const parser = this.parsers.get(language);
    if (!parser) {
      return { nodes: [], edges: [], filePath, language };
    }

    try {
      const tree = parser.parse(code);
      const nodes: GraphNode[] = [];
      const edges: GraphEdge[] = [];

      switch (language as SupportedLanguage) {
        case "typescript":
          this.extractTypeScript(tree.rootNode, code, filePath, nodes, edges);
          break;
        case "javascript":
          this.extractJavaScript(tree.rootNode, code, filePath, nodes, edges);
          break;
        case "go":
          this.extractGo(tree.rootNode, code, filePath, nodes, edges);
          break;
        case "python":
          this.extractPython(tree.rootNode, code, filePath, nodes, edges);
          break;
        case "rust":
          this.extractRust(tree.rootNode, code, filePath, nodes, edges);
          break;
        case "java":
          this.extractJava(tree.rootNode, code, filePath, nodes, edges);
          break;
        case "bash":
          this.extractBash(tree.rootNode, code, filePath, nodes, edges);
          break;
      }

      return { nodes, edges, filePath, language };
    } catch (error) {
      log.warn(
        { filePath, language, err: error },
        "Failed to extract relationships",
      );
      return { nodes: [], edges: [], filePath, language };
    }
  }

  // ---------------------------------------------------------------------------
  // TypeScript extraction
  // ---------------------------------------------------------------------------
  private extractTypeScript(
    root: Parser.SyntaxNode,
    code: string,
    filePath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): void {
    this.traverse(root, (node) => {
      switch (node.type) {
        case "import_statement":
          this.extractTSImport(node, code, filePath, nodes, edges);
          break;
        case "function_declaration":
        case "method_definition":
          this.extractFunctionNode(
            node,
            code,
            filePath,
            "typescript",
            nodes,
          );
          break;
        case "class_declaration":
          this.extractTSClass(node, code, filePath, nodes, edges);
          break;
        case "interface_declaration":
          this.extractTSInterface(node, code, filePath, nodes);
          break;
        case "type_alias_declaration":
          this.extractTSTypeAlias(node, code, filePath, nodes);
          break;
        case "call_expression":
          this.extractCallExpression(
            node,
            code,
            filePath,
            "typescript",
            nodes,
            edges,
          );
          break;
      }
    });
  }

  private extractTSImport(
    node: Parser.SyntaxNode,
    code: string,
    filePath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): void {
    // Get the source module
    const sourceNode = node.childForFieldName("source");
    if (!sourceNode) return;
    const moduleName = this.getNodeText(sourceNode, code).replace(
      /['"]/g,
      "",
    );
    if (!moduleName) return;

    // Get imported names
    const importClause = node.children.find(
      (c) =>
        c.type === "import_clause" ||
        c.type === "named_imports" ||
        c.type === "import_specifier",
    );

    // Find all imported identifiers
    const importedNames: string[] = [];
    this.traverse(node, (child) => {
      if (child.type === "identifier" && child.parent?.type !== "import_statement") {
        const name = this.getNodeText(child, code);
        if (isValidName(name)) {
          importedNames.push(name);
        }
      }
    });

    // If no specific imports found, use the module name
    if (importedNames.length === 0) {
      const cleanModule = moduleName.split("/").pop() ?? moduleName;
      if (isValidName(cleanModule)) {
        importedNames.push(cleanModule);
      }
    }

    // Create a module node for the file
    const moduleNode = this.getOrCreateModuleNode(
      filePath,
      "typescript",
      nodes,
    );

    for (const name of importedNames) {
      const targetId = `${UNRESOLVED_PREFIX}${name}`;
      edges.push({
        sourceId: moduleNode.id,
        targetId,
        relationshipType: "imports",
        sourceFile: filePath,
        targetFile: null,
      });
    }
  }

  private extractTSClass(
    node: Parser.SyntaxNode,
    code: string,
    filePath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;
    const name = this.getNodeText(nameNode, code);
    if (!isValidName(name)) return;

    const classNode: GraphNode = {
      id: generateNodeId(filePath, name, "class", node.startPosition.row + 1),
      name,
      nodeType: "class",
      filePath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      language: "typescript",
    };
    nodes.push(classNode);

    // Check for extends clause
    const heritage = node.children.find(
      (c) => c.type === "class_heritage",
    );
    if (heritage) {
      this.traverse(heritage, (child) => {
        if (child.type === "extends_clause") {
          const extendsType = child.children.find(
            (c) => c.type === "identifier" || c.type === "type_identifier",
          );
          if (extendsType) {
            const extendsName = this.getNodeText(extendsType, code);
            if (isValidName(extendsName)) {
              edges.push({
                sourceId: classNode.id,
                targetId: `${UNRESOLVED_PREFIX}${extendsName}`,
                relationshipType: "extends",
                sourceFile: filePath,
                targetFile: null,
              });
            }
          }
        }
        if (
          child.type === "implements_clause"
        ) {
          for (const typeChild of child.children) {
            if (
              typeChild.type === "type_identifier" ||
              typeChild.type === "identifier"
            ) {
              const implName = this.getNodeText(typeChild, code);
              if (isValidName(implName)) {
                edges.push({
                  sourceId: classNode.id,
                  targetId: `${UNRESOLVED_PREFIX}${implName}`,
                  relationshipType: "implements",
                  sourceFile: filePath,
                  targetFile: null,
                });
              }
            }
          }
        }
      });
    }
  }

  private extractTSInterface(
    node: Parser.SyntaxNode,
    code: string,
    filePath: string,
    nodes: GraphNode[],
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;
    const name = this.getNodeText(nameNode, code);
    if (!isValidName(name)) return;

    nodes.push({
      id: generateNodeId(
        filePath,
        name,
        "interface",
        node.startPosition.row + 1,
      ),
      name,
      nodeType: "interface",
      filePath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      language: "typescript",
    });
  }

  private extractTSTypeAlias(
    node: Parser.SyntaxNode,
    code: string,
    filePath: string,
    nodes: GraphNode[],
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;
    const name = this.getNodeText(nameNode, code);
    if (!isValidName(name)) return;

    nodes.push({
      id: generateNodeId(filePath, name, "type", node.startPosition.row + 1),
      name,
      nodeType: "type",
      filePath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      language: "typescript",
    });
  }

  // ---------------------------------------------------------------------------
  // JavaScript extraction (same as TS minus type annotations)
  // ---------------------------------------------------------------------------
  private extractJavaScript(
    root: Parser.SyntaxNode,
    code: string,
    filePath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): void {
    this.traverse(root, (node) => {
      switch (node.type) {
        case "import_statement":
          this.extractJSImport(node, code, filePath, nodes, edges);
          break;
        case "function_declaration":
        case "method_definition":
          this.extractFunctionNode(
            node,
            code,
            filePath,
            "javascript",
            nodes,
          );
          break;
        case "class_declaration":
          this.extractJSClass(node, code, filePath, nodes, edges);
          break;
        case "call_expression":
          this.extractCallExpression(
            node,
            code,
            filePath,
            "javascript",
            nodes,
            edges,
          );
          break;
      }
    });
  }

  private extractJSImport(
    node: Parser.SyntaxNode,
    code: string,
    filePath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): void {
    const sourceNode = node.childForFieldName("source");
    if (!sourceNode) return;
    const moduleName = this.getNodeText(sourceNode, code).replace(
      /['"]/g,
      "",
    );
    if (!moduleName) return;

    const importedNames: string[] = [];
    this.traverse(node, (child) => {
      if (child.type === "identifier" && child.parent?.type !== "import_statement") {
        const name = this.getNodeText(child, code);
        if (isValidName(name)) {
          importedNames.push(name);
        }
      }
    });

    if (importedNames.length === 0) {
      const cleanModule = moduleName.split("/").pop() ?? moduleName;
      if (isValidName(cleanModule)) {
        importedNames.push(cleanModule);
      }
    }

    const moduleNode = this.getOrCreateModuleNode(
      filePath,
      "javascript",
      nodes,
    );

    for (const name of importedNames) {
      edges.push({
        sourceId: moduleNode.id,
        targetId: `${UNRESOLVED_PREFIX}${name}`,
        relationshipType: "imports",
        sourceFile: filePath,
        targetFile: null,
      });
    }
  }

  private extractJSClass(
    node: Parser.SyntaxNode,
    code: string,
    filePath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;
    const name = this.getNodeText(nameNode, code);
    if (!isValidName(name)) return;

    const classNode: GraphNode = {
      id: generateNodeId(filePath, name, "class", node.startPosition.row + 1),
      name,
      nodeType: "class",
      filePath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      language: "javascript",
    };
    nodes.push(classNode);

    // Check for extends (class heritage)
    const heritage = node.children.find(
      (c) => c.type === "class_heritage",
    );
    if (heritage) {
      this.traverse(heritage, (child) => {
        if (child.type === "identifier") {
          const extendsName = this.getNodeText(child, code);
          if (isValidName(extendsName)) {
            edges.push({
              sourceId: classNode.id,
              targetId: `${UNRESOLVED_PREFIX}${extendsName}`,
              relationshipType: "extends",
              sourceFile: filePath,
              targetFile: null,
            });
          }
        }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Go extraction
  // ---------------------------------------------------------------------------
  private extractGo(
    root: Parser.SyntaxNode,
    code: string,
    filePath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): void {
    this.traverse(root, (node) => {
      switch (node.type) {
        case "import_declaration":
          this.extractGoImport(node, code, filePath, nodes, edges);
          break;
        case "function_declaration":
          this.extractFunctionNode(node, code, filePath, "go", nodes);
          break;
        case "method_declaration":
          this.extractGoMethod(node, code, filePath, nodes);
          break;
        case "type_declaration":
          this.extractGoTypeDecl(node, code, filePath, nodes, edges);
          break;
        case "call_expression":
          this.extractCallExpression(
            node,
            code,
            filePath,
            "go",
            nodes,
            edges,
          );
          break;
      }
    });
  }

  private extractGoImport(
    node: Parser.SyntaxNode,
    code: string,
    filePath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): void {
    const moduleNode = this.getOrCreateModuleNode(filePath, "go", nodes);

    this.traverse(node, (child) => {
      if (child.type === "import_spec" || child.type === "interpreted_string_literal") {
        const text = this.getNodeText(child, code).replace(/["`]/g, "");
        if (!text) return;
        const pkgName = text.split("/").pop() ?? text;
        if (isValidName(pkgName)) {
          edges.push({
            sourceId: moduleNode.id,
            targetId: `${UNRESOLVED_PREFIX}${pkgName}`,
            relationshipType: "imports",
            sourceFile: filePath,
            targetFile: null,
          });
        }
      }
    });
  }

  private extractGoMethod(
    node: Parser.SyntaxNode,
    code: string,
    filePath: string,
    nodes: GraphNode[],
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;
    const name = this.getNodeText(nameNode, code);
    if (!isValidName(name)) return;

    // Include receiver type in the name for methods
    const receiver = node.childForFieldName("receiver");
    let fullName = name;
    if (receiver) {
      const receiverTypes = this.findChildrenByType(receiver, [
        "type_identifier",
        "pointer_type",
      ]);
      if (receiverTypes.length > 0) {
        const receiverName = this.getNodeText(receiverTypes[0], code).replace(
          /^\*/,
          "",
        );
        if (isValidName(receiverName)) {
          fullName = `${receiverName}.${name}`;
        }
      }
    }

    if (!isValidName(fullName)) return;

    nodes.push({
      id: generateNodeId(
        filePath,
        fullName,
        "method",
        node.startPosition.row + 1,
      ),
      name: fullName,
      nodeType: "method",
      filePath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      language: "go",
    });
  }

  private extractGoTypeDecl(
    node: Parser.SyntaxNode,
    code: string,
    filePath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): void {
    this.traverse(node, (child) => {
      if (child.type === "type_spec") {
        const nameNode = child.childForFieldName("name");
        if (!nameNode) return;
        const name = this.getNodeText(nameNode, code);
        if (!isValidName(name)) return;

        const typeNode = child.childForFieldName("type");
        const isInterface = typeNode?.type === "interface_type";

        const graphNode: GraphNode = {
          id: generateNodeId(
            filePath,
            name,
            isInterface ? "interface" : "type",
            child.startPosition.row + 1,
          ),
          name,
          nodeType: isInterface ? "interface" : "type",
          filePath,
          startLine: child.startPosition.row + 1,
          endLine: child.endPosition.row + 1,
          language: "go",
        };
        nodes.push(graphNode);

        // Check for embedded interfaces
        if (isInterface && typeNode) {
          this.traverse(typeNode, (iChild) => {
            if (
              iChild.type === "type_identifier" &&
              iChild.parent?.type !== "method_spec"
            ) {
              const embeddedName = this.getNodeText(iChild, code);
              if (isValidName(embeddedName)) {
                edges.push({
                  sourceId: graphNode.id,
                  targetId: `${UNRESOLVED_PREFIX}${embeddedName}`,
                  relationshipType: "extends",
                  sourceFile: filePath,
                  targetFile: null,
                });
              }
            }
          });
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Python extraction
  // ---------------------------------------------------------------------------
  private extractPython(
    root: Parser.SyntaxNode,
    code: string,
    filePath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): void {
    this.traverse(root, (node) => {
      switch (node.type) {
        case "import_statement":
        case "import_from_statement":
          this.extractPythonImport(node, code, filePath, nodes, edges);
          break;
        case "function_definition":
          this.extractFunctionNode(node, code, filePath, "python", nodes);
          break;
        case "class_definition":
          this.extractPythonClass(node, code, filePath, nodes, edges);
          break;
        case "call":
          this.extractPythonCall(node, code, filePath, nodes, edges);
          break;
      }
    });
  }

  private extractPythonImport(
    node: Parser.SyntaxNode,
    code: string,
    filePath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): void {
    const moduleNode = this.getOrCreateModuleNode(filePath, "python", nodes);

    if (node.type === "import_statement") {
      // import foo, bar
      this.traverse(node, (child) => {
        if (
          child.type === "dotted_name" ||
          child.type === "aliased_import"
        ) {
          const name =
            child.type === "aliased_import"
              ? this.getNodeText(
                  child.childForFieldName("alias") ?? child.children[0],
                  code,
                )
              : this.getNodeText(child, code);
          const cleanName = name.split(".").pop() ?? name;
          if (isValidName(cleanName)) {
            edges.push({
              sourceId: moduleNode.id,
              targetId: `${UNRESOLVED_PREFIX}${cleanName}`,
              relationshipType: "imports",
              sourceFile: filePath,
              targetFile: null,
            });
          }
        }
      });
    } else {
      // from foo import bar, baz
      const importedNames: string[] = [];
      this.traverse(node, (child) => {
        if (child.type === "aliased_import" || child.type === "dotted_name") {
          if (child.parent?.type === "import_from_statement") {
            // This is the module being imported from - skip
            const prevSibling = child.previousSibling;
            if (prevSibling?.type === "from") return;
          }
          const name =
            child.type === "aliased_import"
              ? this.getNodeText(
                  child.childForFieldName("alias") ?? child.children[0],
                  code,
                )
              : this.getNodeText(child, code);
          const cleanName = name.split(".").pop() ?? name;
          if (isValidName(cleanName)) {
            importedNames.push(cleanName);
          }
        }
        if (child.type === "identifier" && child.parent?.type === "import_from_statement") {
          // Direct identifier children of import_from_statement (e.g., from foo import bar)
          const prevSibling = child.previousSibling;
          if (prevSibling?.type !== "from" && prevSibling?.type !== "import") {
            // skip 'from' keyword's identifier
          } else if (prevSibling?.type === "import") {
            const name = this.getNodeText(child, code);
            if (isValidName(name)) {
              importedNames.push(name);
            }
          }
        }
      });

      for (const name of importedNames) {
        edges.push({
          sourceId: moduleNode.id,
          targetId: `${UNRESOLVED_PREFIX}${name}`,
          relationshipType: "imports",
          sourceFile: filePath,
          targetFile: null,
        });
      }
    }
  }

  private extractPythonClass(
    node: Parser.SyntaxNode,
    code: string,
    filePath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;
    const name = this.getNodeText(nameNode, code);
    if (!isValidName(name)) return;

    const classNode: GraphNode = {
      id: generateNodeId(filePath, name, "class", node.startPosition.row + 1),
      name,
      nodeType: "class",
      filePath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      language: "python",
    };
    nodes.push(classNode);

    // Extract base classes (superclass_list / argument_list after class name)
    const superclasses = node.childForFieldName("superclasses");
    if (superclasses) {
      for (const child of superclasses.children) {
        if (child.type === "identifier") {
          const baseName = this.getNodeText(child, code);
          if (isValidName(baseName)) {
            edges.push({
              sourceId: classNode.id,
              targetId: `${UNRESOLVED_PREFIX}${baseName}`,
              relationshipType: "extends",
              sourceFile: filePath,
              targetFile: null,
            });
          }
        }
        if (child.type === "attribute") {
          const attrName = this.getNodeText(child, code);
          if (isValidName(attrName.replace(/\./g, "_"))) {
            edges.push({
              sourceId: classNode.id,
              targetId: `${UNRESOLVED_PREFIX}${attrName}`,
              relationshipType: "extends",
              sourceFile: filePath,
              targetFile: null,
            });
          }
        }
      }
    }
  }

  private extractPythonCall(
    node: Parser.SyntaxNode,
    code: string,
    filePath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): void {
    const funcNode = node.childForFieldName("function");
    if (!funcNode) return;

    let callName: string;
    if (funcNode.type === "identifier") {
      callName = this.getNodeText(funcNode, code);
    } else if (funcNode.type === "attribute") {
      const attr = funcNode.childForFieldName("attribute");
      callName = attr ? this.getNodeText(attr, code) : this.getNodeText(funcNode, code);
    } else {
      return;
    }

    if (!isValidName(callName)) return;

    // Find the enclosing function/class to use as the source
    const sourceNode = this.findEnclosingDefinition(node, code, filePath, "python", nodes);
    if (!sourceNode) return;

    edges.push({
      sourceId: sourceNode.id,
      targetId: `${UNRESOLVED_PREFIX}${callName}`,
      relationshipType: "calls",
      sourceFile: filePath,
      targetFile: null,
    });
  }

  // ---------------------------------------------------------------------------
  // Rust extraction
  // ---------------------------------------------------------------------------
  private extractRust(
    root: Parser.SyntaxNode,
    code: string,
    filePath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): void {
    this.traverse(root, (node) => {
      switch (node.type) {
        case "use_declaration":
          this.extractRustUse(node, code, filePath, nodes, edges);
          break;
        case "function_item":
          this.extractFunctionNode(node, code, filePath, "rust", nodes);
          break;
        case "impl_item":
          this.extractRustImpl(node, code, filePath, nodes, edges);
          break;
        case "struct_item":
        case "enum_item":
          this.extractRustStruct(node, code, filePath, nodes);
          break;
        case "trait_item":
          this.extractRustTrait(node, code, filePath, nodes);
          break;
        case "call_expression":
          this.extractCallExpression(
            node,
            code,
            filePath,
            "rust",
            nodes,
            edges,
          );
          break;
        case "macro_invocation":
          this.extractRustMacro(node, code, filePath, nodes, edges);
          break;
      }
    });
  }

  private extractRustUse(
    node: Parser.SyntaxNode,
    code: string,
    filePath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): void {
    const moduleNode = this.getOrCreateModuleNode(filePath, "rust", nodes);

    // Extract the path from use declarations
    this.traverse(node, (child) => {
      if (child.type === "identifier" && child.nextSibling === null) {
        // Last identifier in a use path
        const name = this.getNodeText(child, code);
        if (isValidName(name)) {
          edges.push({
            sourceId: moduleNode.id,
            targetId: `${UNRESOLVED_PREFIX}${name}`,
            relationshipType: "imports",
            sourceFile: filePath,
            targetFile: null,
          });
        }
      }
    });
  }

  private extractRustImpl(
    node: Parser.SyntaxNode,
    code: string,
    filePath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): void {
    const typeNode = node.childForFieldName("type");
    if (!typeNode) return;
    const typeName = this.getNodeText(typeNode, code);
    if (!isValidName(typeName)) return;

    const implNode: GraphNode = {
      id: generateNodeId(
        filePath,
        typeName,
        "class",
        node.startPosition.row + 1,
      ),
      name: typeName,
      nodeType: "class",
      filePath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      language: "rust",
    };
    nodes.push(implNode);

    // Check for trait implementation
    const traitNode = node.childForFieldName("trait");
    if (traitNode) {
      const traitName = this.getNodeText(traitNode, code);
      if (isValidName(traitName)) {
        edges.push({
          sourceId: implNode.id,
          targetId: `${UNRESOLVED_PREFIX}${traitName}`,
          relationshipType: "implements",
          sourceFile: filePath,
          targetFile: null,
        });
      }
    }
  }

  private extractRustStruct(
    node: Parser.SyntaxNode,
    code: string,
    filePath: string,
    nodes: GraphNode[],
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;
    const name = this.getNodeText(nameNode, code);
    if (!isValidName(name)) return;

    nodes.push({
      id: generateNodeId(filePath, name, "type", node.startPosition.row + 1),
      name,
      nodeType: "type",
      filePath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      language: "rust",
    });
  }

  private extractRustTrait(
    node: Parser.SyntaxNode,
    code: string,
    filePath: string,
    nodes: GraphNode[],
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;
    const name = this.getNodeText(nameNode, code);
    if (!isValidName(name)) return;

    nodes.push({
      id: generateNodeId(
        filePath,
        name,
        "interface",
        node.startPosition.row + 1,
      ),
      name,
      nodeType: "interface",
      filePath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      language: "rust",
    });
  }

  private extractRustMacro(
    node: Parser.SyntaxNode,
    code: string,
    filePath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): void {
    const macroNode = node.childForFieldName("macro");
    if (!macroNode) return;
    const macroName = this.getNodeText(macroNode, code);
    if (!isValidName(macroName)) return;

    const sourceNode = this.findEnclosingDefinition(
      node,
      code,
      filePath,
      "rust",
      nodes,
    );
    if (!sourceNode) return;

    edges.push({
      sourceId: sourceNode.id,
      targetId: `${UNRESOLVED_PREFIX}${macroName}`,
      relationshipType: "calls",
      sourceFile: filePath,
      targetFile: null,
    });
  }

  // ---------------------------------------------------------------------------
  // Java extraction
  // ---------------------------------------------------------------------------
  private extractJava(
    root: Parser.SyntaxNode,
    code: string,
    filePath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): void {
    this.traverse(root, (node) => {
      switch (node.type) {
        case "import_declaration":
          this.extractJavaImport(node, code, filePath, nodes, edges);
          break;
        case "method_declaration":
          this.extractFunctionNode(node, code, filePath, "java", nodes);
          break;
        case "class_declaration":
          this.extractJavaClass(node, code, filePath, nodes, edges);
          break;
        case "interface_declaration":
          this.extractJavaInterface(node, code, filePath, nodes, edges);
          break;
        case "method_invocation":
          this.extractJavaMethodCall(node, code, filePath, nodes, edges);
          break;
      }
    });
  }

  private extractJavaImport(
    node: Parser.SyntaxNode,
    code: string,
    filePath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): void {
    const moduleNode = this.getOrCreateModuleNode(filePath, "java", nodes);

    // Get the scoped identifier
    this.traverse(node, (child) => {
      if (child.type === "scoped_identifier" && child.parent?.type === "import_declaration") {
        const fullPath = this.getNodeText(child, code);
        const name = fullPath.split(".").pop() ?? fullPath;
        if (isValidName(name)) {
          edges.push({
            sourceId: moduleNode.id,
            targetId: `${UNRESOLVED_PREFIX}${name}`,
            relationshipType: "imports",
            sourceFile: filePath,
            targetFile: null,
          });
        }
      }
    });
  }

  private extractJavaClass(
    node: Parser.SyntaxNode,
    code: string,
    filePath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;
    const name = this.getNodeText(nameNode, code);
    if (!isValidName(name)) return;

    const classNode: GraphNode = {
      id: generateNodeId(filePath, name, "class", node.startPosition.row + 1),
      name,
      nodeType: "class",
      filePath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      language: "java",
    };
    nodes.push(classNode);

    // Superclass — AST: superclass { extends, type_identifier }
    for (const child of node.children) {
      if (child.type === "superclass") {
        this.traverse(child, (sc) => {
          if (sc.type === "type_identifier") {
            const superName = this.getNodeText(sc, code);
            if (isValidName(superName)) {
              edges.push({
                sourceId: classNode.id,
                targetId: `${UNRESOLVED_PREFIX}${superName}`,
                relationshipType: "extends",
                sourceFile: filePath,
                targetFile: null,
              });
            }
          }
        });
      }
    }

    // Interfaces — AST: super_interfaces { implements, type_list { type_identifier... } }
    for (const child of node.children) {
      if (child.type === "super_interfaces") {
        this.traverse(child, (si) => {
          if (si.type === "type_identifier") {
            const ifaceName = this.getNodeText(si, code);
            if (isValidName(ifaceName)) {
              edges.push({
                sourceId: classNode.id,
                targetId: `${UNRESOLVED_PREFIX}${ifaceName}`,
                relationshipType: "implements",
                sourceFile: filePath,
                targetFile: null,
              });
            }
          }
        });
      }
    }
  }

  private extractJavaInterface(
    node: Parser.SyntaxNode,
    code: string,
    filePath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;
    const name = this.getNodeText(nameNode, code);
    if (!isValidName(name)) return;

    const ifaceNode: GraphNode = {
      id: generateNodeId(
        filePath,
        name,
        "interface",
        node.startPosition.row + 1,
      ),
      name,
      nodeType: "interface",
      filePath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      language: "java",
    };
    nodes.push(ifaceNode);

    // Extended interfaces
    const extendsInterfaces = node.childForFieldName("type_parameters");
    // Look for extends_interfaces in children
    for (const child of node.children) {
      if (child.type === "extends_interfaces") {
        this.traverse(child, (grandchild) => {
          if (grandchild.type === "type_identifier") {
            const extName = this.getNodeText(grandchild, code);
            if (isValidName(extName)) {
              edges.push({
                sourceId: ifaceNode.id,
                targetId: `${UNRESOLVED_PREFIX}${extName}`,
                relationshipType: "extends",
                sourceFile: filePath,
                targetFile: null,
              });
            }
          }
        });
      }
    }
  }

  private extractJavaMethodCall(
    node: Parser.SyntaxNode,
    code: string,
    filePath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;
    const callName = this.getNodeText(nameNode, code);
    if (!isValidName(callName)) return;

    const sourceNode = this.findEnclosingDefinition(
      node,
      code,
      filePath,
      "java",
      nodes,
    );
    if (!sourceNode) return;

    edges.push({
      sourceId: sourceNode.id,
      targetId: `${UNRESOLVED_PREFIX}${callName}`,
      relationshipType: "calls",
      sourceFile: filePath,
      targetFile: null,
    });
  }

  // ---------------------------------------------------------------------------
  // Bash extraction
  // ---------------------------------------------------------------------------
  private extractBash(
    root: Parser.SyntaxNode,
    code: string,
    filePath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): void {
    this.traverse(root, (node) => {
      switch (node.type) {
        case "function_definition":
          this.extractBashFunction(node, code, filePath, nodes);
          break;
        case "command":
          this.extractBashCommand(node, code, filePath, nodes, edges);
          break;
      }
    });
  }

  private extractBashFunction(
    node: Parser.SyntaxNode,
    code: string,
    filePath: string,
    nodes: GraphNode[],
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;
    const name = this.getNodeText(nameNode, code);
    if (!isValidName(name)) return;

    nodes.push({
      id: generateNodeId(
        filePath,
        name,
        "function",
        node.startPosition.row + 1,
      ),
      name,
      nodeType: "function",
      filePath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      language: "bash",
    });
  }

  private extractBashCommand(
    node: Parser.SyntaxNode,
    code: string,
    filePath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): void {
    const cmdNameNode = node.childForFieldName("name");
    if (!cmdNameNode) return;
    const cmdName = this.getNodeText(cmdNameNode, code);

    // Check for source/. commands (imports)
    if (cmdName === "source" || cmdName === ".") {
      const args = node.children.filter((c) => c.type === "word" || c.type === "string");
      if (args.length > 0) {
        const moduleNode = this.getOrCreateModuleNode(
          filePath,
          "bash",
          nodes,
        );
        const sourcedFile = this.getNodeText(args[0], code).replace(
          /['"]/g,
          "",
        );
        const cleanName = sourcedFile.split("/").pop() ?? sourcedFile;
        if (isValidName(cleanName)) {
          edges.push({
            sourceId: moduleNode.id,
            targetId: `${UNRESOLVED_PREFIX}${cleanName}`,
            relationshipType: "imports",
            sourceFile: filePath,
            targetFile: null,
          });
        }
      }
      return;
    }

    // Regular function calls
    if (!isValidName(cmdName)) return;

    const sourceNode = this.findEnclosingDefinition(
      node,
      code,
      filePath,
      "bash",
      nodes,
    );
    if (!sourceNode) return;

    edges.push({
      sourceId: sourceNode.id,
      targetId: `${UNRESOLVED_PREFIX}${cmdName}`,
      relationshipType: "calls",
      sourceFile: filePath,
      targetFile: null,
    });
  }

  // ---------------------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------------------

  /**
   * Extract a function/method declaration node.
   */
  private extractFunctionNode(
    node: Parser.SyntaxNode,
    code: string,
    filePath: string,
    language: string,
    nodes: GraphNode[],
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;
    const name = this.getNodeText(nameNode, code);
    if (!isValidName(name)) return;

    const nodeType: NodeType = node.type.includes("method")
      ? "method"
      : "function";

    nodes.push({
      id: generateNodeId(
        filePath,
        name,
        nodeType,
        node.startPosition.row + 1,
      ),
      name,
      nodeType,
      filePath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      language,
    });
  }

  /**
   * Extract a call expression (TS/JS/Go/Rust shared pattern).
   */
  private extractCallExpression(
    node: Parser.SyntaxNode,
    code: string,
    filePath: string,
    language: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): void {
    const funcNode = node.childForFieldName("function");
    if (!funcNode) return;

    let callName: string;
    if (funcNode.type === "identifier") {
      callName = this.getNodeText(funcNode, code);
    } else if (
      funcNode.type === "member_expression" ||
      funcNode.type === "field_expression" ||
      funcNode.type === "selector_expression"
    ) {
      // Get the method/field name (rightmost part)
      const fieldNode =
        funcNode.childForFieldName("field") ??
        funcNode.childForFieldName("property");
      callName = fieldNode
        ? this.getNodeText(fieldNode, code)
        : this.getNodeText(funcNode, code);
    } else {
      return;
    }

    if (!isValidName(callName)) return;

    const sourceNode = this.findEnclosingDefinition(
      node,
      code,
      filePath,
      language,
      nodes,
    );
    if (!sourceNode) return;

    edges.push({
      sourceId: sourceNode.id,
      targetId: `${UNRESOLVED_PREFIX}${callName}`,
      relationshipType: "calls",
      sourceFile: filePath,
      targetFile: null,
    });
  }

  /**
   * Traverse the AST and call the visitor for each node.
   */
  private traverse(
    node: Parser.SyntaxNode,
    visitor: (node: Parser.SyntaxNode) => void,
  ): void {
    visitor(node);
    for (const child of node.children) {
      this.traverse(child, visitor);
    }
  }

  /**
   * Get the text of a syntax node.
   */
  private getNodeText(node: Parser.SyntaxNode, code: string): string {
    return code.substring(node.startIndex, node.endIndex);
  }

  /**
   * Find children of a specific type.
   */
  private findChildrenByType(
    node: Parser.SyntaxNode,
    types: string[],
  ): Parser.SyntaxNode[] {
    const results: Parser.SyntaxNode[] = [];
    this.traverse(node, (child) => {
      if (types.includes(child.type)) {
        results.push(child);
      }
    });
    return results;
  }

  /**
   * Get or create a module-level node for the file.
   */
  private getOrCreateModuleNode(
    filePath: string,
    language: string,
    nodes: GraphNode[],
  ): GraphNode {
    const existing = nodes.find(
      (n) => n.nodeType === "module" && n.filePath === filePath,
    );
    if (existing) return existing;

    const name = filePath.split("/").pop()?.replace(/\.[^.]+$/, "") ?? filePath;
    const moduleNode: GraphNode = {
      id: generateNodeId(filePath, name, "module", 1),
      name,
      nodeType: "module",
      filePath,
      startLine: 1,
      endLine: 1,
      language,
    };
    nodes.push(moduleNode);
    return moduleNode;
  }

  /**
   * Find the nearest enclosing function/class definition for a given node.
   * This is used to determine the source of a "calls" edge.
   * Falls back to the module-level node if no enclosing definition is found.
   */
  private findEnclosingDefinition(
    node: Parser.SyntaxNode,
    code: string,
    filePath: string,
    language: string,
    nodes: GraphNode[],
  ): GraphNode | null {
    const enclosingTypes = [
      "function_declaration",
      "function_definition",
      "function_item",
      "method_declaration",
      "method_definition",
      "class_declaration",
      "class_definition",
      "impl_item",
    ];

    let current: Parser.SyntaxNode | null = node.parent;
    while (current) {
      if (enclosingTypes.includes(current.type)) {
        const nameNode = current.childForFieldName("name");
        if (nameNode) {
          const name = this.getNodeText(nameNode, code);
          if (isValidName(name)) {
            // Find the matching node we already created
            const existing = nodes.find(
              (n) =>
                n.name === name &&
                n.filePath === filePath &&
                n.startLine === current!.startPosition.row + 1,
            );
            if (existing) return existing;
          }
        }
      }
      current = current.parent;
    }

    // Fall back to module node
    return this.getOrCreateModuleNode(filePath, language, nodes);
  }
}
