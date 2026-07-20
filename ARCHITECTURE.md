# Lattice architecture

## 1. System purpose

Lattice is a local-first knowledge layer for source-code repositories. Its planned outputs are a living wiki, structural dependency map, knowledge graph, and task-specific context for people and coding agents. The first product stage, deterministic repository scanning, is implemented; parsing and knowledge generation remain planned.

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
- **cli:** Owns the command-line transport. It implements `lattice index [repository-path]`, defaulting to the current directory, and prints a concise scan summary. Other planned commands are not implemented.
- **mcp-server:** Owns the future Model Context Protocol transport for coding agents. It currently prints `Lattice MCP Server` and implements no MCP behavior.

Applications are entry points and composition roots. Reusable logic belongs in libraries.

## 4. Library responsibilities

### Core

- **parser:** Language-independent parsing interfaces.
- **indexer:** Validates repository roots and deterministically describes source files. It owns ignore policy, binary and size filtering, extension-based language detection, stable path IDs, scan models, and repository-scanning domain errors. Parsing and incremental persistence are not implemented.
- **analyzer:** Deterministic and future AI-assisted analysis.
- **knowledge:** Knowledge pages, claims, summaries, and links.
- **graph:** Graph entities, relationships, and traversal.

### Data access

- **database:** Persistence abstraction.
- **git:** Repository and commit operations.
- **filesystem:** Provides the injected filesystem boundary used by the indexer: canonical paths, metadata, deterministic traversal, reads, and SHA-256 operations. It wraps raw Node filesystem failures before they cross the adapter boundary.

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

Shared projects must stay domain-neutral. All library public APIs flow through their `src/index.ts` entry points.

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

The indexer's import of the public `@lattice/filesystem` abstraction is the single
core-to-data-access exception. ESLint allows that exact public alias without opening
core libraries to other data-access projects or internal filesystem modules.

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

This diagram shows the intended entry-point relationships, not a set of running distributed services. All components are local processes in one monorepo. The CLI invokes the repository scanner for `lattice index`; the MCP entry point still only prints a startup message, the web application is static scaffolding, and the API only reports health.

## 7. Current data flow

```text
Repository
    ↓
Filesystem Scanner
    ↓
Repository Scan
    ↓
(Parsers — planned)
    ↓
Knowledge Builder — planned
```

The CLI calls the core indexer, which uses the injected filesystem adapter. The
adapter walks entries and reads file bytes; the indexer applies ignore and file
eligibility policy and returns a scan sorted by repository-relative path. A scan
contains no parsed code or persisted state and does not modify its repository.

The API still implements only `GET /health`. The web and MCP entry points do not
consume repository scans yet.

## 8. Planned architecture

> **Planned — not implemented.**

Repository scans will feed deterministic parsers, analysis, knowledge, and graph libraries. Data-access adapters will eventually persist local state. Feature libraries will compose wiki, search, and context-building behavior. LLM assistance will remain optional, provider-independent, validated, and downstream of deterministic analysis. The web, API, CLI, and MCP entry points will expose those shared capabilities without forming a microservice architecture.

## 9. Architectural decision log

| Date       | Decision                                                                             | Status   | Rationale                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-07-20 | Use an Nx integrated monorepo                                                        | Accepted | Centralizes project orchestration, caching, graph analysis, and enforceable boundaries.                                                                            |
| 2026-07-20 | Use npm as the package manager                                                       | Accepted | Provides a standard cross-platform workflow and matches the repository requirement.                                                                                |
| 2026-07-20 | Use TypeScript as the primary language                                               | Accepted | Enables strict, shared contracts across browser and Node entry points.                                                                                             |
| 2026-07-20 | Keep separate web, API, CLI, and MCP entry points                                    | Accepted | Keeps transport and bootstrapping concerns explicit while sharing libraries.                                                                                       |
| 2026-07-20 | Organize libraries by core, data access, features, integrations, and shared concerns | Accepted | Makes dependency direction and ownership visible and enforceable.                                                                                                  |
| 2026-07-20 | Use a local-first architecture                                                       | Accepted | Repository contents and generated knowledge should remain local by default; cloud services are optional.                                                           |
| 2026-07-20 | Prefer deterministic analysis before LLM-assisted interpretation                     | Accepted | Produces reproducible evidence and limits untrusted inference to appropriate boundaries.                                                                           |
| 2026-07-20 | Keep repository I/O behind an injected filesystem adapter                            | Accepted | Keeps scanner policy separate from Node I/O, makes failures explicit, and supports deterministic tests.                                                            |
| 2026-07-20 | Derive file identity from normalized relative paths and content hashes from bytes    | Accepted | Makes unchanged scan records stable and provides deterministic inputs for future incremental indexing.                                                             |
| 2026-07-20 | Allow the indexer to depend on the public filesystem abstraction                     | Accepted | The scanner domain orchestrates repository discovery while direct filesystem operations remain in the adapter; the exception is limited to the exact public alias. |

## 10. Documentation-update rules

Update this file whenever components, project responsibilities, dependency rules, runtime topology, data flow, or architectural decisions change. Update `DEBUG.md` for meaningful investigations and reusable failure modes, library READMEs when their responsibilities or APIs change, and the root README when setup or user-facing behavior changes. Documentation must describe implemented reality and clearly label planned behavior.
