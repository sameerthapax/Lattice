import {
  RepositoryScanError,
  scanRepository,
  type RepositoryScan,
} from '@lattice/core-indexer';
import {
  analyzeRepository,
  ParserInitializationError,
  type RepositoryAnalysis,
} from '@lattice/core-parser';
import {
  NodeRepositoryFileSystem,
  type RepositoryFileSystem,
} from '@lattice/filesystem';

import {
  buildAnalyzeJsonOutput,
  buildAnalyzeSummary,
  formatAnalyzeSummary,
  serializeAnalyzeJson,
} from './analyze-output';

export interface CliDependencies {
  readonly currentDirectory: () => string;
  readonly nowMilliseconds: () => number;
  readonly scan: typeof scanRepository;
  readonly analyze: typeof analyzeRepository;
  readonly fileSystem: RepositoryFileSystem;
  readonly writeError: (message: string) => void;
  readonly writeOutput: (message: string) => void;
}

const defaultDependencies: CliDependencies = {
  analyze: analyzeRepository,
  currentDirectory: () => process.cwd(),
  fileSystem: new NodeRepositoryFileSystem(),
  nowMilliseconds: () => performance.now(),
  scan: scanRepository,
  writeError: (message: string): void => console.error(message),
  writeOutput: (message: string): void => {
    process.stdout.write(message);
  },
};

interface ParsedCliArguments {
  readonly command: 'index' | 'analyze';
  readonly repositoryPath: string | null;
  readonly json: boolean;
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

  const { command, repositoryPath, json } = parsedArguments;
  const startTime = json ? null : dependencies.nowMilliseconds();
  try {
    const scan = await dependencies.scan({
      rootPath: repositoryPath ?? dependencies.currentDirectory(),
    });
    if (command === 'analyze') {
      const analysis = await dependencies.analyze({
        scan,
        fileSystem: dependencies.fileSystem,
      });
      if (json) {
        dependencies.writeOutput(
          serializeAnalyzeJson(buildAnalyzeJsonOutput(analysis)),
        );
      } else {
        const durationSeconds = elapsedSeconds(startTime, dependencies);
        dependencies.writeOutput(
          `${formatAnalyzeSummary(buildAnalyzeSummary(analysis), durationSeconds)}\n`,
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
        error instanceof ParserInitializationError
        ? error.message
        : command === 'analyze'
          ? 'Repository analysis failed unexpectedly.'
          : 'Repository scan failed unexpectedly.',
    );
    return 1;
  }
}

export function formatAnalysisSummary(
  analysis: RepositoryAnalysis,
  durationSeconds: number,
): string {
  return formatAnalyzeSummary(buildAnalyzeSummary(analysis), durationSeconds);
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
  if (command !== 'index' && command !== 'analyze') {
    return 'Usage: lattice <index|analyze> [repository-path]';
  }

  let repositoryPath: string | null = null;
  let json = false;
  for (const value of values) {
    if (value.startsWith('-')) {
      if (value === '--json' && command === 'analyze' && !json) {
        json = true;
        continue;
      }
      return `Unknown option: ${value}\nUsage: lattice ${command} [repository-path]${command === 'analyze' ? ' [--json]' : ''}`;
    }
    if (repositoryPath !== null) {
      return `Usage: lattice ${command} [repository-path]${command === 'analyze' ? ' [--json]' : ''}`;
    }
    repositoryPath = value;
  }

  return { command, repositoryPath, json };
}

function elapsedSeconds(
  startTime: number | null,
  dependencies: CliDependencies,
): number {
  return startTime === null
    ? 0
    : (dependencies.nowMilliseconds() - startTime) / 1_000;
}
