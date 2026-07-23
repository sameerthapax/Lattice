import type { RepositoryScan } from '@lattice/core-indexer';
import type {
  WorkspaceProjectDefinition,
  WorkspaceProjectEntryPoint,
  WorkspaceProjectKind,
} from '@lattice/core-knowledge';
import type { RepositoryFileSystem } from '@lattice/filesystem';

interface ProjectConfiguration {
  readonly name?: unknown;
  readonly projectType?: unknown;
  readonly sourceRoot?: unknown;
  readonly targets?: unknown;
}

interface PackageConfiguration {
  readonly name?: unknown;
  readonly workspaces?: unknown;
  readonly main?: unknown;
  readonly module?: unknown;
  readonly types?: unknown;
  readonly exports?: unknown;
}

export async function loadWorkspaceProjects(
  scan: RepositoryScan,
  fileSystem: RepositoryFileSystem,
): Promise<readonly WorkspaceProjectDefinition[]> {
  const configurationFiles = scan.files
    .filter(
      (file) =>
        file.relativePath === 'project.json' ||
        file.relativePath.endsWith('/project.json'),
    )
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'en'));
  const projects: WorkspaceProjectDefinition[] = [];
  for (const file of configurationFiles) {
    const text = await fileSystem.readOptionalText(file.absolutePath);
    if (text === null) continue;
    const parsed: unknown = JSON.parse(text);
    if (!isObject(parsed)) continue;
    const configuration: ProjectConfiguration = parsed;
    if (
      typeof configuration.name !== 'string' ||
      configuration.name.length === 0
    )
      continue;
    const rootRelativePath =
      file.relativePath === 'project.json'
        ? ''
        : file.relativePath.slice(0, -'/project.json'.length);
    const sourceRootRelativePath =
      typeof configuration.sourceRoot === 'string'
        ? configuration.sourceRoot
        : undefined;
    const entryPoints = findConfiguredEntryPoints(configuration.targets);
    projects.push({
      name: configuration.name,
      kind: toProjectKind(configuration.projectType),
      rootRelativePath,
      ...(sourceRootRelativePath === undefined
        ? {}
        : { sourceRootRelativePath }),
      ...(entryPoints.length === 0 ? {} : { entryPoints }),
    });
  }
  const occupiedRoots = new Set(
    projects.map((project) => project.rootRelativePath),
  );
  const workspacePatterns = await loadPackageWorkspacePatterns(
    scan,
    fileSystem,
  );
  for (const file of scan.files
    .filter(
      (candidate) =>
        candidate.relativePath.endsWith('/package.json') &&
        candidate.relativePath !== 'package.json',
    )
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'en'))) {
    const rootRelativePath = file.relativePath.slice(
      0,
      -'/package.json'.length,
    );
    if (
      occupiedRoots.has(rootRelativePath) ||
      !workspacePatterns.some((pattern) =>
        matchesWorkspacePattern(rootRelativePath, pattern),
      )
    )
      continue;
    const text = await fileSystem.readOptionalText(file.absolutePath);
    if (text === null) continue;
    const parsed: unknown = JSON.parse(text);
    if (!isObject(parsed)) continue;
    const configuration: PackageConfiguration = parsed;
    if (
      typeof configuration.name !== 'string' ||
      configuration.name.length === 0
    )
      continue;
    const entryPoints = packageEntryPoints(
      configuration,
      rootRelativePath,
      scan,
    );
    projects.push({
      name: configuration.name,
      kind: 'unknown',
      rootRelativePath,
      ...(entryPoints.length === 0 ? {} : { entryPoints }),
    });
  }
  return projects.sort(
    (a, b) =>
      a.rootRelativePath.localeCompare(b.rootRelativePath, 'en') ||
      a.name.localeCompare(b.name, 'en'),
  );
}

async function loadPackageWorkspacePatterns(
  scan: RepositoryScan,
  fileSystem: RepositoryFileSystem,
): Promise<readonly string[]> {
  const rootPackage = scan.files.find(
    (file) => file.relativePath === 'package.json',
  );
  if (!rootPackage) return [];
  const text = await fileSystem.readOptionalText(rootPackage.absolutePath);
  if (text === null) return [];
  const parsed: unknown = JSON.parse(text);
  if (!isObject(parsed)) return [];
  const workspaces = parsed['workspaces'];
  const values = Array.isArray(workspaces)
    ? workspaces
    : isObject(workspaces) && Array.isArray(workspaces['packages'])
      ? workspaces['packages']
      : [];
  return values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.replace(/^\.\//, '').replace(/\/$/, ''))
    .sort((a, b) => a.localeCompare(b, 'en'));
}

function matchesWorkspacePattern(value: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replaceAll('**', '\0')
    .replaceAll('*', '[^/]*')
    .replaceAll('\0', '.*');
  return new RegExp(`^${escaped}$`, 'u').test(value);
}

function packageEntryPoints(
  configuration: PackageConfiguration,
  rootRelativePath: string,
  scan: RepositoryScan,
): readonly WorkspaceProjectEntryPoint[] {
  const candidates = new Set<string>();
  for (const value of [
    configuration.main,
    configuration.module,
    configuration.types,
  ])
    if (typeof value === 'string') candidates.add(value);
  collectExportPaths(configuration.exports, candidates);
  const scannedPaths = new Set(scan.files.map((file) => file.relativePath));
  return [...candidates]
    .map((value) =>
      `${rootRelativePath}/${value.replace(/^\.\//, '')}`.replaceAll('//', '/'),
    )
    .filter((relativePath) => scannedPaths.has(relativePath))
    .sort((a, b) => a.localeCompare(b, 'en'))
    .map((relativePath) => ({ relativePath }));
}

function collectExportPaths(value: unknown, result: Set<string>): void {
  if (typeof value === 'string') {
    result.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectExportPaths(item, result);
    return;
  }
  if (isObject(value))
    for (const item of Object.values(value)) collectExportPaths(item, result);
}

function findConfiguredEntryPoints(
  targets: unknown,
): readonly WorkspaceProjectEntryPoint[] {
  if (!isObject(targets)) return [];
  const paths = new Set<string>();
  for (const target of Object.values(targets)) {
    if (!isObject(target)) continue;
    const options = target['options'];
    if (!isObject(options)) continue;
    const main = options['main'];
    if (typeof main === 'string') paths.add(main.replace(/^\.\//, ''));
  }
  return [...paths]
    .sort((a, b) => a.localeCompare(b, 'en'))
    .map((relativePath) => ({ relativePath }));
}

function toProjectKind(value: unknown): WorkspaceProjectKind {
  return value === 'application'
    ? 'application'
    : value === 'library'
      ? 'library'
      : 'unknown';
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
