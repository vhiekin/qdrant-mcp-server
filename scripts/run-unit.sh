#!/bin/bash
# Unit test runner for qdrant-mcp-server graph module
# Usage: ./scripts/run-unit.sh [test-file-pattern...]
set -e
cd "$(dirname "$0")/.."
npx vitest run "$@"
