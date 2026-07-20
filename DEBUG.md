# Debugging journal

## Purpose

This file records meaningful investigations and reusable failure modes so future contributors can distinguish known setup constraints from product defects.

## Update rules

Add an entry when an investigation reveals a non-obvious root cause, a recurring environment issue, or a prevention step worth preserving. Record observed facts only. Do not add routine typo fixes or invent issues. Move an issue to resolved only after verification.

## Debugging-session template

```markdown
## YYYY-MM-DD — Short issue title

### Context

### Symptoms

### Reproduction

### Investigation

### Root cause

### Fix

### Verification

### Prevention and follow-up
```

## Known issues

### 2026-07-20 — Next.js transitive PostCSS audit advisory

#### Context

The workspace uses the current installed Next.js 16.2.10 release.

#### Symptoms

`npm audit` reports two moderate findings: one for `next` and one for its bundled `postcss@8.4.31`, associated with GHSA-qx2v-qp2m-jg93.

#### Reproduction

Run `npm audit` after installation.

#### Investigation

The workspace-level PostCSS packages are patched at 8.5.20. The remaining affected copy is internal to Next.js. npm proposes Next.js 9.3.3 as the available remediation, which is an incompatible downgrade and not a valid fix for this workspace.

#### Root cause

The current Next.js package pins an affected PostCSS version internally.

#### Fix

No safe workspace-level fix is currently applied. The separate low-severity esbuild finding was resolved by upgrading the compatible direct dependency to 0.28.1.

#### Verification

After the esbuild upgrade, `npm audit` reports two moderate findings and no low, high, or critical findings. All quality checks still pass.

#### Prevention and follow-up

Re-run the audit when Next.js publishes an updated stable release. Do not apply npm's suggested major downgrade.

### 2026-07-20 — Nx initialization and generator dependency installation stalled

#### Context

The workspace was initialized inside an existing, minimal Git repository in a restricted execution environment.

#### Symptoms

`nx init` and the first run of generators that attempted an implicit npm install wrote no further output and did not terminate. A subsequent explicit `npm install` also reported a peer-dependency conflict.

#### Reproduction

Run interactive `nx init` or allow a generator to install newly added packages when registry access is unavailable. With ESLint 10 selected independently, install the Nx-generated ESLint plugin set.

#### Investigation

The Nx CLI itself responded normally to `nx --version`, and generators completed when their dependencies were already installed. The explicit npm error showed that `eslint-plugin-import@2.31.0`, selected by the Nx generator stack, supports ESLint through major version 9 rather than ESLint 10.

#### Root cause

The interactive/implicit install path could not complete under restricted registry access. Separately, unconstrained installation selected ESLint 10 before the Nx 23 generator added plugins whose declared peer range ends at ESLint 9.

#### Fix

Create the minimal integrated-workspace root configuration explicitly, perform dependency installation with approved registry access, and pin the current ESLint 9 release compatible with the Nx-generated plugin stack.

#### Verification

After removing the deprecated TypeScript 6 `baseUrl` option, formatting and linting succeeded across all 20 projects, Vitest succeeded across all 19 configured Node/library projects, and all 20 build targets succeeded.

#### Prevention and follow-up

Keep Nx packages on one version and check peer ranges before upgrading ESLint across a major version. Prefer non-interactive generators and explicit installs in restricted environments.

## Resolved issues

_None yet._
