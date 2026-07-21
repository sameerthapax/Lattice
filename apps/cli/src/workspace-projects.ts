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
  return projects;
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
