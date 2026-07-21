import {
  resolveRepositoryAnalysis,
  ResolverInputError,
  type ResolvedRepositoryAnalysis,
  type WorkspaceModuleAlias,
} from '@lattice/core-analyzer';
import {
  RepositoryScanError,
  scanRepository,
  SupportedLanguage,
  type RepositoryScan,
} from '@lattice/core-indexer';
import {
  analyzeRepository,
  ParserInitializationError,
  type RepositoryAnalysis,
} from '@lattice/core-parser';
import {
  buildRepositoryKnowledge,
  KnowledgeBuilderInputError,
  type RepositoryKnowledge,
  type WorkspaceProjectDefinition,
} from '@lattice/core-knowledge';
import {
  NodeRepositoryFileSystem,
  type RepositoryFileSystem,
} from '@lattice/filesystem';
import {
  buildContextPackage,
  ContextBuilderInputError,
  type ContextPackage,
  type ContextSelectionOptions,
  type SymbolContextTarget,
  type ContextTarget,
} from '@lattice/context-builder';

import {
  buildAnalyzeJsonOutput,
  buildAnalyzeSummary,
  formatAnalyzeSummary,
  serializeAnalyzeJson,
} from './analyze-output';
import { loadWorkspaceAliases } from './workspace-aliases';
import { loadWorkspaceProjects } from './workspace-projects';

export interface CliDependencies {
  readonly currentDirectory: () => string;
  readonly nowMilliseconds: () => number;
  readonly scan: typeof scanRepository;
  readonly analyze: typeof analyzeRepository;
  readonly resolve: typeof resolveRepositoryAnalysis;
  readonly loadAliases: (
    rootPath: string,
    fileSystem: RepositoryFileSystem,
  ) => Promise<readonly WorkspaceModuleAlias[]>;
  readonly loadProjects?: (
    scan: RepositoryScan,
    fileSystem: RepositoryFileSystem,
  ) => Promise<readonly WorkspaceProjectDefinition[]>;
  readonly fileSystem: RepositoryFileSystem;
  readonly writeError: (message: string) => void;
  readonly writeOutput: (message: string) => void;
}

const defaultDependencies: CliDependencies = {
  analyze: analyzeRepository,
  currentDirectory: () => process.cwd(),
  fileSystem: new NodeRepositoryFileSystem(),
  loadAliases: loadWorkspaceAliases,
  loadProjects: loadWorkspaceProjects,
  nowMilliseconds: () => performance.now(),
  scan: scanRepository,
  resolve: resolveRepositoryAnalysis,
  writeError: (message: string): void => console.error(message),
  writeOutput: (message: string): void => {
    process.stdout.write(message);
  },
};

interface ParsedCliArguments {
  readonly command: 'index' | 'analyze' | 'context';
  readonly repositoryPath: string | null;
  readonly json: boolean;
  readonly contextTarget: ContextTarget | null;
  readonly contextOptions: ContextSelectionOptions;
}

export async function runCli(
  arguments_: readonly string[],
  dependencies: CliDependencies = defaultDependencies,
): Promise<number> {
  const parsedArguments = parseCliArguments(arguments_);
  if (typeof parsedArguments === 'string') {
    dependencies.writeError(parsedArguments);
    return 1;
  }

  const { command, repositoryPath, json, contextTarget, contextOptions } =
    parsedArguments;
  const startTime = json ? null : dependencies.nowMilliseconds();
  try {
    const scan = await dependencies.scan({
      rootPath: repositoryPath ?? dependencies.currentDirectory(),
    });
    if (command === 'analyze' || command === 'context') {
      const analysis = await dependencies.analyze({
        scan,
        fileSystem: dependencies.fileSystem,
      });
      const resolution = dependencies.resolve({
        scan,
        analysis,
        workspaceAliases: await dependencies.loadAliases(
          scan.rootPath,
          dependencies.fileSystem,
        ),
      });
      const knowledge = buildRepositoryKnowledge({
        scan,
        analysis,
        resolution,
        projects: await (dependencies.loadProjects ?? (async () => []))(
          scan,
          dependencies.fileSystem,
        ),
      });
      if (command === 'context') {
        const package_ = await buildContextPackage({
          scan,
          analysis,
          resolution,
          knowledge,
          target: contextTarget as ContextTarget,
          options: contextOptions,
          sourceProvider:
            contextOptions.includeSource === false
              ? undefined
              : {
                  readSource: async ({
                    fileId,
                    relativePath,
                    expectedContentHash,
                  }) => {
                    const scanned = scan.files.find(
                      (file) =>
                        file.id === fileId &&
                        file.relativePath === relativePath,
                    );
                    if (!scanned)
                      throw new Error(
                        'Requested source is absent from the repository scan.',
                      );
                    if (scanned.contentHash !== expectedContentHash)
                      throw new Error(
                        'Requested source hash differs from the scan.',
                      );
                    const bytes = await dependencies.fileSystem.readBytes(
                      scanned.absolutePath,
                    );
                    return {
                      fileId,
                      relativePath,
                      contentHash: dependencies.fileSystem.hashBytes(bytes),
                      content: bytes.toString('utf8'),
                    };
                  },
                },
        });
        dependencies.writeOutput(
          json
            ? `${JSON.stringify(package_)}\n`
            : `${formatContextSummary(package_)}\n`,
        );
      } else if (json) {
        dependencies.writeOutput(
          serializeAnalyzeJson(
            buildAnalyzeJsonOutput(analysis, resolution, knowledge),
          ),
        );
      } else {
        const durationSeconds = elapsedSeconds(startTime, dependencies);
        dependencies.writeOutput(
          `${formatAnalyzeSummary(buildAnalyzeSummary(analysis, resolution, knowledge), durationSeconds)}\n`,
        );
      }
    } else {
      const durationSeconds = elapsedSeconds(startTime, dependencies);
      dependencies.writeOutput(`${formatScanSummary(scan, durationSeconds)}\n`);
    }
    return 0;
  } catch (error: unknown) {
    dependencies.writeError(
      error instanceof RepositoryScanError ||
        error instanceof ParserInitializationError ||
        error instanceof ResolverInputError ||
        error instanceof KnowledgeBuilderInputError ||
        error instanceof ContextBuilderInputError
        ? error.message
        : command === 'analyze' || command === 'context'
          ? 'Repository analysis failed unexpectedly.'
          : 'Repository scan failed unexpectedly.',
    );
    return 1;
  }
}

export function formatAnalysisSummary(
  analysis: RepositoryAnalysis,
  durationSeconds: number,
  resolution: ResolvedRepositoryAnalysis = resolveRepositoryAnalysis({
    scan: {
      rootPath: analysis.rootPath,
      scannedAt: analysis.analyzedAt,
      totalFiles: analysis.files.length,
      totalDirectories: 0,
      totalIgnoredEntries: 0,
      files: analysis.files.map((file) => ({
        id: file.fileId,
        relativePath: file.relativePath,
        absolutePath: `${analysis.rootPath}/${file.relativePath}`,
        extension: null,
        language:
          file.language === 'TypeScript'
            ? SupportedLanguage.TypeScript
            : file.language === 'TSX'
              ? SupportedLanguage.TSX
              : file.language === 'JavaScript'
                ? SupportedLanguage.JavaScript
                : SupportedLanguage.JSX,
        sizeBytes: 0,
        contentHash: file.contentHash,
        lastModified: analysis.analyzedAt,
      })),
    },
    analysis,
  }),
): string {
  const syntheticScan: RepositoryScan = {
    rootPath: analysis.rootPath,
    scannedAt: analysis.analyzedAt,
    totalFiles: analysis.files.length,
    totalDirectories: 0,
    totalIgnoredEntries: 0,
    files: analysis.files.map((file) => ({
      id: file.fileId,
      relativePath: file.relativePath,
      absolutePath: `${analysis.rootPath}/${file.relativePath}`,
      extension: null,
      language:
        file.language === 'TypeScript'
          ? SupportedLanguage.TypeScript
          : file.language === 'TSX'
            ? SupportedLanguage.TSX
            : file.language === 'JavaScript'
              ? SupportedLanguage.JavaScript
              : SupportedLanguage.JSX,
      sizeBytes: 0,
      contentHash: file.contentHash,
      lastModified: analysis.analyzedAt,
    })),
  };
  const knowledge: RepositoryKnowledge = buildRepositoryKnowledge({
    scan: syntheticScan,
    analysis,
    resolution,
  });
  return formatAnalyzeSummary(
    buildAnalyzeSummary(analysis, resolution, knowledge),
    durationSeconds,
  );
}

export function formatScanSummary(
  scan: RepositoryScan,
  durationSeconds: number,
): string {
  const languageCounts = new Map<string, number>();
  for (const file of scan.files) {
    languageCounts.set(
      file.language,
      (languageCounts.get(file.language) ?? 0) + 1,
    );
  }

  const languageLines = [...languageCounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([language, count]) => `${language}: ${count}`);

  return [
    'Repository scanned successfully',
    `Directories: ${scan.totalDirectories}`,
    `Files: ${scan.totalFiles}`,
    'Languages',
    ...languageLines,
    `Ignored: ${scan.totalIgnoredEntries}`,
    `Duration: ${durationSeconds.toFixed(2)}s`,
  ].join('\n');
}

function parseCliArguments(
  arguments_: readonly string[],
): ParsedCliArguments | string {
  const [command, ...values] = arguments_;
  if (command !== 'index' && command !== 'analyze' && command !== 'context') {
    return 'Usage: lattice <index|analyze|context> [repository-path]';
  }

  let repositoryPath: string | null = null;
  let json = false;
  let contextTarget: ContextTarget | null = null;
  const contextOptions: Record<string, boolean | number> = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] as string;
    if (value.startsWith('-')) {
      if (value === '--json' && command !== 'index' && !json) {
        json = true;
        continue;
      }
      if (command === 'context') {
        if (value === '--no-source') {
          contextOptions.includeSource = false;
          continue;
        }
        const targetKinds: Record<string, ContextTarget['kind']> = {
          '--file': 'file',
          '--symbol': 'symbol',
          '--folder': 'folder',
          '--project': 'project',
        };
        if (value in targetKinds) {
          const targetValue = values[++index];
          if (!targetValue || targetValue.startsWith('-') || contextTarget)
            return contextUsage();
          const kind = targetKinds[value] as ContextTarget['kind'];
          contextTarget =
            kind === 'file'
              ? { kind, relativePath: targetValue }
              : kind === 'symbol'
                ? { kind, qualifiedName: targetValue }
                : kind === 'folder'
                  ? { kind, relativePath: targetValue }
                  : { kind, name: targetValue };
          continue;
        }
        if (value === '--in') {
          const file = values[++index];
          if (!file || contextTarget?.kind !== 'symbol') return contextUsage();
          const symbolTarget: SymbolContextTarget = contextTarget;
          contextTarget = {
            kind: 'symbol',
            qualifiedName: symbolTarget.qualifiedName,
            fileRelativePath: file,
          };
          continue;
        }
        const optionNames: Record<string, keyof ContextSelectionOptions> = {
          '--max-files': 'maxFiles',
          '--max-symbols': 'maxSymbols',
          '--max-relations': 'maxRelations',
          '--max-excerpts': 'maxExcerpts',
          '--max-source-chars': 'maxTotalSourceCharacters',
          '--dependency-depth': 'dependencyDepth',
          '--dependent-depth': 'dependentDepth',
        };
        if (value in optionNames) {
          const raw = values[++index];
          const parsed = Number(raw);
          if (!raw || !Number.isInteger(parsed))
            return `Invalid numeric option: ${value}`;
          contextOptions[optionNames[value] as string] = parsed;
          continue;
        }
      }
      return `Unknown option: ${value}\nUsage: lattice ${command} [repository-path]${command === 'analyze' ? ' [--json]' : ''}`;
    }
    if (repositoryPath !== null) {
      return `Usage: lattice ${command} [repository-path]${command === 'analyze' ? ' [--json]' : ''}`;
    }
    repositoryPath = value;
  }
  if (command === 'context' && !contextTarget) return contextUsage();
  return { command, repositoryPath, json, contextTarget, contextOptions };
}

function contextUsage(): string {
  return 'Usage: lattice context [repository-path] <--file path|--symbol name [--in path]|--folder path|--project name> [--json] [--no-source]';
}

export function formatContextSummary(package_: ContextPackage): string {
  const targetFile = package_.target.relativePath
    ? `\nFile: ${package_.target.relativePath}`
    : '';
  const project = package_.entities.projects.find(
    (item) => item.nodeId === package_.target.projectId,
  );
  const omissions = package_.omissions.map(
    (item) => `${item.reason}: ${item.count}`,
  );
  return [
    'Context package',
    `Target: ${package_.target.kind} ${package_.target.qualifiedName}`,
    `${targetFile}${project ? `\nProject: ${project.name}` : ''}`.trim(),
    'Selected',
    `Files: ${package_.metrics.fileCount}`,
    `Symbols: ${package_.metrics.symbolCount}`,
    `Relationships: ${package_.metrics.relationCount}`,
    `Source excerpts: ${package_.metrics.excerptCount}`,
    `Source characters: ${package_.metrics.sourceCharacterCount.toLocaleString('en-US')}`,
    ...(omissions.length ? ['Omissions', ...omissions] : []),
  ]
    .filter(Boolean)
    .join('\n');
}

function elapsedSeconds(
  startTime: number | null,
  dependencies: CliDependencies,
): number {
  return startTime === null
    ? 0
    : (dependencies.nowMilliseconds() - startTime) / 1_000;
}
