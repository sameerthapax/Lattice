import {
  RepositoryScanError,
  scanRepository,
  type RepositoryScan,
} from '@lattice/core-indexer';

export interface CliDependencies {
  readonly currentDirectory: () => string;
  readonly nowMilliseconds: () => number;
  readonly scan: typeof scanRepository;
  readonly writeError: (message: string) => void;
  readonly writeOutput: (message: string) => void;
}

const defaultDependencies: CliDependencies = {
  currentDirectory: () => process.cwd(),
  nowMilliseconds: () => performance.now(),
  scan: scanRepository,
  writeError: (message: string): void => console.error(message),
  writeOutput: (message: string): void => console.log(message),
};

export async function runCli(
  arguments_: readonly string[],
  dependencies: CliDependencies = defaultDependencies,
): Promise<number> {
  const [command, repositoryPath, ...extraArguments] = arguments_;
  if (command !== 'index' || extraArguments.length > 0) {
    dependencies.writeError('Usage: lattice index [repository-path]');
    return 1;
  }

  const startTime = dependencies.nowMilliseconds();
  try {
    const scan = await dependencies.scan({
      rootPath: repositoryPath ?? dependencies.currentDirectory(),
    });
    const durationSeconds =
      (dependencies.nowMilliseconds() - startTime) / 1_000;
    dependencies.writeOutput(formatScanSummary(scan, durationSeconds));
    return 0;
  } catch (error: unknown) {
    dependencies.writeError(
      error instanceof RepositoryScanError
        ? error.message
        : 'Repository scan failed unexpectedly.',
    );
    return 1;
  }
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
