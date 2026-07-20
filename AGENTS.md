# Agent instructions

## Project purpose

Lattice is a local-first repository knowledge layer. It is intended to create:

- A living wiki
- A structural code map
- A knowledge graph
- Context packages for coding agents

Most product behavior is not implemented yet. Keep initialization work separate from future product work.

## Engineering principles

- Prefer simple, explicit implementations.
- Do not over-engineer speculative abstractions.
- Keep modules focused on one responsibility.
- Separate pure domain logic from I/O.
- Use dependency injection at integration boundaries.
- Prefer deterministic analysis before LLM inference.
- Deterministic syntax extraction must precede semantic or LLM-assisted interpretation.
- Keep Tree-sitter-specific types internal to the parser boundary.
- Partial syntax errors must not invalidate an otherwise analyzable repository.
- Machine-readable CLI output must use explicit versioned DTOs rather than blindly serializing domain models.
- Successful JSON commands must emit only JSON on stdout and omit nondeterministic timestamps and durations.
- Treat LLM output as untrusted input and validate it.
- Preserve evidence and provenance for generated knowledge.
- Make incremental operations idempotent.
- Avoid hidden global state.
- Avoid circular dependencies.
- Use clear names rather than abbreviations.
- Prefer composition over inheritance.
- Do not add dependencies without a concrete need.
- Keep the project local-first and cloud-optional.
- Never commit secrets, generated credentials, or local repository data.

## TypeScript rules

- Use strict TypeScript.
- Do not use `any` unless it is isolated and documented.
- Prefer `unknown` for untrusted values.
- Give exported functions explicit return types.
- Introduce Zod or equivalent validation at system boundaries when validation is needed.
- Use discriminated unions for stateful workflows.
- Prefer readonly data where mutation is unnecessary.
- Do not use non-null assertions without justification.
- Do not silently swallow errors.

## Code organization

- Applications handle bootstrapping and transport concerns.
- Libraries contain reusable domain and integration logic.
- Use `@lattice/*` aliases for cross-project imports.
- Do not import another library's internal implementation details; use its public `src/index.ts` entry point.
- Keep shared libraries small and domain-neutral. Do not place domain logic in shared.
- Give every new project Nx scope and type tags and make it obey the module-boundary rules.
- Libraries must never import applications.

## Testing rules

- Test meaningful behavior.
- Write unit tests for pure logic.
- Write integration tests for I/O boundaries.
- Add regression tests for fixed bugs.
- Assert behavior rather than implementation details.
- Do not create placeholder tests that only assert `true`.

## Error-handling rules

- Add context when rethrowing errors.
- Use typed domain errors when useful.
- Do not expose secrets or full source content in logs unnecessarily.
- Fail explicitly when repository state is invalid.
- Keep user-facing errors actionable.

## Documentation maintenance

Documentation is part of the implementation. For every relevant change, update:

- `ARCHITECTURE.md` when components, dependencies, data flow, boundaries, or major technical decisions change.
- `DEBUG.md` when a meaningful debugging investigation occurs or a reusable failure mode is discovered.
- The relevant library README when its responsibility or public API changes.
- The root `README.md` when setup commands or user-facing behavior changes.

Do not claim a task is complete while these documents are stale.

## Change workflow

1. Inspect the affected projects and documentation.
2. State assumptions in the implementation notes when requirements are ambiguous.
3. Make the smallest coherent change.
4. Add or update tests.
5. Run formatting, linting, tests, and affected builds.
6. Update architecture or debugging documentation where relevant.
7. Summarize changed files, decisions, tests, and remaining risks.

## Prohibited behavior

- Do not rewrite unrelated code.
- Do not disable lint or TypeScript rules to bypass errors.
- Do not delete tests merely because they fail.
- Do not introduce broad abstractions for one use case.
- Do not add cloud infrastructure during local MVP work.
- Do not silently change public APIs.
- Do not store indexed repository contents in Git by default.
- Do not fabricate completed test results.
