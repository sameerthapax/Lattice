# Lattice

An AI-powered repository knowledge layer that builds a living wiki, dependency map, and knowledge graph for developers and coding agents.

> **Status:** Early development. Deterministic repository scanning, syntax analysis,
> cross-file module resolution, deterministic structural knowledge, and bounded
> deterministic context packages are implemented.

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
Milestone 4 builds repository/project/folder/file/symbol hierarchy nodes, maps files
to workspace projects from committed project metadata, computes effective file
surfaces and configured-entry-point project surfaces, aggregates cross-project
dependencies, and reports structural metrics.
Milestone 5 constructs focused file, symbol, folder, and project packages using
bounded dependency/dependent expansion, explicit structural ranking, selected source
excerpts, and deterministic omission reporting.
File context prioritizes target declarations and imported bindings. Project context
includes directly adjacent projects and their dependency records. Folder context
uses source-first ranking and exact descendant-folder depth; mandatory hierarchy for
selected files may extend deeper. File metrics remain repository-wide while emitted
relationships and excerpts remain independently bounded.

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

Build context for a repository entity:

```sh
lattice context --file apps/cli/src/cli.ts
lattice context --symbol runCli --in apps/cli/src/cli.ts
lattice context --project cli --json
lattice context --folder libs/core --no-source
```

`context --json` emits the context package itself with independent schema version
`"1"` and one trailing newline. Human output shows selection counts without source.
Limits include files, symbols, relations, excerpts, source characters, and dependency
and dependent depth. Invalid or ambiguous targets and invalid limits exit nonzero.

The JSON schema version is `3`. It preserves scanner/parser output and the
`resolution` section containing modules, internal and external dependencies, symbol
bindings, unresolved dependencies, and cycles. It adds a `knowledge` section with
structural nodes, relations, project dependencies, and summaries. Source code is not
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
Repository knowledge
Projects: 12
Folders: 47
Files: 182
Symbols: 212
Public file symbols: 96
Public project symbols: 41
Cross-project dependencies: 18
Orphan source files: 3
Duration: 0.12s
```

When working directly from a checkout without installing the package executable,
use `node dist/apps/cli/main.js index .` or
`node dist/apps/cli/main.js analyze .` after building.

Analysis is syntax-level and deterministic; it does not claim compiler-level
semantic understanding. Feature inference, semantic module clustering, CommonJS,
dynamic imports, package.json export conditions, TypeScript compiler resolution,
call/type/runtime graphs, persistence, semantic search, embeddings, wiki rendering,
LLM summaries, token-aware packing, automatic feature detection, Git history context,
and MCP context exposure remain unimplemented.

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
