import type { WorkspaceModuleAlias } from '@lattice/core-analyzer';
import type { RepositoryFileSystem } from '@lattice/filesystem';

interface TypeScriptConfiguration {
  readonly compilerOptions?: {
    readonly paths?: Readonly<Record<string, unknown>>;
  };
}

export async function loadWorkspaceAliases(
  rootPath: string,
  fileSystem: RepositoryFileSystem,
): Promise<readonly WorkspaceModuleAlias[]> {
  const configurationText = await fileSystem.readOptionalText(
    fileSystem.resolvePath(`${rootPath}/tsconfig.base.json`),
  );
  if (configurationText === null) return [];
  const parsed: unknown = JSON.parse(configurationText);
  if (!isConfiguration(parsed)) return [];
  const aliases: WorkspaceModuleAlias[] = [];
  for (const [rawAlias, rawTargets] of Object.entries(
    parsed.compilerOptions?.paths ?? {},
  ).sort(([left], [right]) => left.localeCompare(right, 'en'))) {
    if (
      !Array.isArray(rawTargets) ||
      !rawTargets.every((item): item is string => typeof item === 'string')
    )
      continue;
    const alias = rawAlias.endsWith('/*') ? rawAlias.slice(0, -2) : rawAlias;
    const targetRelativePaths = rawTargets.map((target) =>
      target.replace(/^\.\//, '').replace(/\/\*$/, '/index.ts'),
    );
    if (alias.length > 0 && targetRelativePaths.length > 0)
      aliases.push({ alias, targetRelativePaths });
  }
  return aliases;
}

function isConfiguration(value: unknown): value is TypeScriptConfiguration {
  return typeof value === 'object' && value !== null;
}
