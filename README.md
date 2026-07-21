# Lattice

An AI-powered repository knowledge layer that builds a living wiki, dependency map, and knowledge graph for developers and coding agents.

> **Status:** Early development. Deterministic repository scanning, syntax analysis,
> and cross-file module resolution are implemented; knowledge generation remains planned.

## Vision

Lattice is a local-first knowledge layer for source repositories. It is intended to combine a living wiki, structural code map, knowledge graph, and task-specific context packages while keeping cloud services optional.

## Workspace

- `apps/web` — Next.js interface entry point
- `apps/api` — Fastify HTTP API with `GET /health`
- `apps/cli` — local command-line entry point
- `apps/mcp-server` — future coding-agent interface entry point
- `libs/core` — parser, indexer, analyzer, knowledge, and graph domains
- `libs/data-access` — database, Git, and file-system boundaries
- `libs/features` — wiki, search, and context-building capabilities
- `libs/integrations` — LLM and MCP integration boundaries
- `libs/shared` — small domain-neutral types, utilities, and configuration

## Requirements

- Node.js 22 or newer
- npm 11 or newer

## Installation

```sh
npm install
```

## Current capabilities

Lattice can scan and analyze a local repository without modifying it. The scanner recursively
discovers text source files, applies hardcoded ignores plus `.gitignore` and
`.latticeignore`, skips binary files and files larger than 10 MiB, detects supported
languages by extension, and computes stable path IDs and content hashes. The parser
then verifies those hashes and extracts language-independent symbols, static ES
module imports, exports, and recoverable syntax diagnostics from TypeScript, TSX,
JavaScript, and JSX. Milestone 3 resolves internal relative and configured workspace
imports, classifies external packages, connects named/default imports and re-exports
to exported symbols, reports unresolved relationships, and detects dependency cycles.

Build the CLI and run a scan:

```sh
npm run build -- --projects=cli
lattice index .
```

An explicit repository path is also supported:

```sh
lattice index path/to/repository
```

Analyze the current directory or an explicit repository path:

```sh
lattice analyze .
lattice analyze path/to/repository
```

For deterministic machine-readable parser output, add `--json` with or without an
explicit path:

```sh
lattice analyze . --json
lattice analyze --json
```

The JSON schema version is `2`. It preserves scanner/parser output and adds a
`resolution` section containing modules, internal and external dependencies, symbol
bindings, unresolved dependencies, and cycles. Source code is not
included, and paths in file records are repository-relative. Analysis timestamps
and command duration are intentionally omitted so unchanged inputs produce stable
output.

For example, inspect extracted symbols with `jq`:

```sh
lattice analyze . --json | jq '.analysis.files[] | {
  path: .relativePath,
  symbols: .symbols
}'
```

Example output:

```text
Repository analyzed successfully
Files scanned: 167
Files parsed: 36
Files skipped: 131
Parse failures: 0
Symbols
Functions: 42
Classes: 8
Methods: 31
Constructors: 8
Interfaces: 15
Type aliases: 11
Enums: 2
Variables: 19
Imports: 94
Exports: 57
Files with syntax errors: 1
Module resolution
Internal dependencies: 48
External dependencies: 19
Resolved symbol bindings: 73
Unresolved dependencies: 2
Dependency cycles: 1
Use --json to inspect unresolved dependencies.
Duration: 0.12s
```

When working directly from a checkout without installing the package executable,
use `node dist/apps/cli/main.js index .` or
`node dist/apps/cli/main.js analyze .` after building.

Analysis is syntax-level and deterministic; it does not claim compiler-level
semantic understanding. CommonJS, dynamic imports, package.json export conditions,
TypeScript compiler resolution, call graphs, type graphs, persistence, knowledge
generation, semantic search, and AI assistance remain unimplemented.

## Development

```sh
npm run start:web
npm run start:api
npm run start:cli
npm run start:mcp
```

Use `npm run graph` to inspect the Nx project graph.

## Quality checks

```sh
npm run format:check
npm run lint
npm test
npm run build
```

Run `npm run format` to format the workspace.

## Contributing

Read [AGENTS.md](./AGENTS.md) before making changes. Its architecture, testing, documentation, and change-workflow rules apply to contributors and coding agents.

## License

Lattice is licensed under the [Apache License 2.0](./LICENSE).
