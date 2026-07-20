# Lattice architecture

## 1. System purpose

Lattice is a local-first knowledge layer for source-code repositories. Its planned outputs are a living wiki, structural dependency map, knowledge graph, and task-specific context for people and coding agents. The current repository is an initialized platform scaffold; most product behavior is not implemented.

## 2. Current workspace structure

The integrated Nx workspace uses npm and strict TypeScript. Projects live in `apps/` and `libs/`, with ESLint enforcing tagged dependency boundaries.

```text
apps/
  web/                 Next.js App Router application
  api/                 Fastify Node application
  cli/                 Node CLI entry point
  mcp-server/          Node MCP-server entry point
libs/
  core/                parser, indexer, analyzer, knowledge, graph
  data-access/         database, git, filesystem
  features/            wiki, search, context-builder
  integrations/        llm, mcp
  shared/              types, utils, config
```

## 3. Application responsibilities

- **web:** Bootstraps the future local wiki, graph, repository navigation, search, and context-inspection interface. It currently renders only the starter page.
- **api:** Owns local HTTP transport and future indexing orchestration and knowledge queries. It currently exposes only `GET /health`; server construction is separate from network binding.
- **cli:** Owns the future `lattice init`, `lattice index`, and `lattice serve` command surface. It currently prints `Lattice CLI`.
- **mcp-server:** Owns the future Model Context Protocol transport for coding agents. It currently prints `Lattice MCP Server` and implements no MCP behavior.

Applications are entry points and composition roots. Reusable logic belongs in libraries.

## 4. Library responsibilities

### Core

- **parser:** Language-independent parsing interfaces.
- **indexer:** Repository scanning and incremental indexing.
- **analyzer:** Deterministic and future AI-assisted analysis.
- **knowledge:** Knowledge pages, claims, summaries, and links.
- **graph:** Graph entities, relationships, and traversal.

### Data access

- **database:** Persistence abstraction.
- **git:** Repository and commit operations.
- **filesystem:** Controlled file-system access.

### Features

- **wiki:** Generated and human-maintained repository knowledge.
- **search:** Structural, textual, and future semantic retrieval.
- **context-builder:** Task-specific context packages for coding agents.

### Integrations

- **llm:** Provider-independent model interfaces.
- **mcp:** MCP tools, resources, and transport integration.

### Shared

- **types:** Truly cross-cutting types.
- **utils:** Small stateless utilities.
- **config:** Validated application configuration.

Shared projects must stay domain-neutral. All library public APIs flow through their `src/index.ts` entry points; the entry points are intentionally empty at initialization.

## 5. Dependency-direction rules

Nx tags and `@nx/enforce-module-boundaries` define the allowed directions:

| Source       | May depend on                                     |
| ------------ | ------------------------------------------------- |
| Applications | Core, data access, features, integrations, shared |
| Features     | Core, data access, integrations, shared           |
| Core         | Core, shared                                      |
| Data access  | Shared                                            |
| Integrations | Core, shared                                      |
| Shared       | Shared                                            |

No library may import an application. Cross-project imports use `@lattice/*` aliases and public entry points. Circular dependencies are prohibited. A project should not add a dependency merely to demonstrate that it is allowed.

## 6. Current runtime topology

```text
User
├── Web application
├── CLI
└── Coding agent
      │
      ├── API
      └── MCP server
             │
             └── Shared Lattice libraries
```

This diagram shows the intended entry-point relationships, not a set of running distributed services. All components are local processes in one monorepo. The current CLI and MCP entry points only print a startup message, the web application is static scaffolding, and the API only reports health. The libraries contain no product implementation.

## 7. Current data flow

There is no repository-indexing or knowledge data flow yet. The only implemented request path is an HTTP `GET /health` call to the API, which returns a constant service status. The web starter page does not call the API. CLI and MCP processes do not call libraries or persist data.

## 8. Planned architecture

> **Planned — not implemented.**

Repository inputs will enter through controlled Git and file-system adapters. Deterministic parsing, indexing, analysis, knowledge, and graph libraries will transform them into evidence-backed knowledge. Data-access adapters will persist local state. Feature libraries will compose wiki, search, and context-building behavior. LLM assistance will remain optional, provider-independent, validated, and downstream of deterministic analysis. The web, API, CLI, and MCP entry points will expose those shared capabilities without forming a microservice architecture.

## 9. Architectural decision log

| Date       | Decision                                                                             | Status   | Rationale                                                                                                |
| ---------- | ------------------------------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------- |
| 2026-07-20 | Use an Nx integrated monorepo                                                        | Accepted | Centralizes project orchestration, caching, graph analysis, and enforceable boundaries.                  |
| 2026-07-20 | Use npm as the package manager                                                       | Accepted | Provides a standard cross-platform workflow and matches the repository requirement.                      |
| 2026-07-20 | Use TypeScript as the primary language                                               | Accepted | Enables strict, shared contracts across browser and Node entry points.                                   |
| 2026-07-20 | Keep separate web, API, CLI, and MCP entry points                                    | Accepted | Keeps transport and bootstrapping concerns explicit while sharing libraries.                             |
| 2026-07-20 | Organize libraries by core, data access, features, integrations, and shared concerns | Accepted | Makes dependency direction and ownership visible and enforceable.                                        |
| 2026-07-20 | Use a local-first architecture                                                       | Accepted | Repository contents and generated knowledge should remain local by default; cloud services are optional. |
| 2026-07-20 | Prefer deterministic analysis before LLM-assisted interpretation                     | Accepted | Produces reproducible evidence and limits untrusted inference to appropriate boundaries.                 |

## 10. Documentation-update rules

Update this file whenever components, project responsibilities, dependency rules, runtime topology, data flow, or architectural decisions change. Update `DEBUG.md` for meaningful investigations and reusable failure modes, library READMEs when their responsibilities or APIs change, and the root README when setup or user-facing behavior changes. Documentation must describe implemented reality and clearly label planned behavior.
