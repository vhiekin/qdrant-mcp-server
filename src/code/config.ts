/**
 * Configuration and constants for code vectorization
 */

export const DEFAULT_CODE_EXTENSIONS = [
  // TypeScript/JavaScript
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  // Python
  ".py",
  // Go
  ".go",
  // Rust
  ".rs",
  // Java/Kotlin
  ".java",
  ".kt",
  // C/C++
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".cc",
  ".cxx",
  // C#
  ".cs",
  // Ruby
  ".rb",
  // PHP
  ".php",
  // Swift
  ".swift",
  // Dart
  ".dart",
  // Scala
  ".scala",
  // Clojure
  ".clj",
  ".cljs",
  // Haskell
  ".hs",
  // OCaml
  ".ml",
  // Shell
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  // SQL/Data
  ".sql",
  ".proto",
  ".graphql",
  // Web
  ".vue",
  ".svelte",
  // Config/Markup
  ".md",
  ".markdown",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".xml",
];

export const DEFAULT_IGNORE_PATTERNS = [
  // Dependency directories (** prefix to match at any depth)
  "**/node_modules/**",
  "**/.venv/**",
  "**/venv/**",
  "**/vendor/**",
  // Build output
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/target/**",
  "**/.next/**",
  "**/.nuxt/**",
  // Test/coverage output
  "**/coverage/**",
  "**/.nyc_output/**",
  // Caches
  "**/.cache/**",
  "**/__pycache__/**",
  // Version control
  "**/.git/**",
  "**/.svn/**",
  "**/.hg/**",
  // IDE
  "**/.vscode/**",
  "**/.idea/**",
  // Minified/generated files
  "*.min.js",
  "*.min.css",
  "*.bundle.js",
  "*.map",
  "*.pyc",
  // Logs and env
  "*.log",
  ".env",
  ".env.*",
  // Lock files
  "**/package-lock.json",
  "**/.package-lock.json",
  "**/yarn.lock",
  "**/pnpm-lock.yaml",
  "**/*.lock",
];

export const LANGUAGE_MAP: Record<string, string> = {
  // TypeScript/JavaScript
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",

  // Backend languages
  ".py": "python",
  ".java": "java",
  ".go": "go",
  ".rs": "rust",
  ".rb": "ruby",
  ".php": "php",

  // Systems languages
  ".c": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".h": "c",
  ".hpp": "cpp",
  ".cs": "c_sharp",

  // Mobile
  ".swift": "swift",
  ".kt": "kotlin",
  ".dart": "dart",

  // Functional
  ".scala": "scala",
  ".clj": "clojure",
  ".cljs": "clojure",
  ".hs": "haskell",
  ".ml": "ocaml",

  // Scripting
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".fish": "fish",

  // Data/Query
  ".sql": "sql",
  ".proto": "proto",
  ".graphql": "graphql",

  // Markup/Config
  ".md": "markdown",
  ".markdown": "markdown",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".xml": "xml",

  // Web
  ".vue": "vue",
  ".svelte": "svelte",
};

export const DEFAULT_CHUNK_SIZE = 2500;
export const DEFAULT_CHUNK_OVERLAP = 300;
export const DEFAULT_BATCH_SIZE = 100;
export const DEFAULT_SEARCH_LIMIT = 5;
