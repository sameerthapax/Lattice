# Lattice

An AI-powered repository knowledge layer that builds a living wiki, dependency map, and knowledge graph for developers and coding agents.

> **Status:** Early development. The repository currently contains workspace scaffolding and minimal entry points; product capabilities are planned, not implemented.

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
