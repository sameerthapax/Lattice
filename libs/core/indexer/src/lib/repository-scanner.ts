import path from 'node:path';

import {
  FileSystemAccessError,
  NodeRepositoryFileSystem,
  type RepositoryFileSystem,
} from '@lattice/filesystem';

import {
  InvalidRepositoryError,
  PermissionDeniedError,
  RepositoryNotFoundError,
  RepositoryScanError,
} from './errors';
import { IgnoreRules } from './ignore-rules';
import { detectLanguage } from './language';
import type {
  RepositoryScan,
  ScanRepositoryOptions,
  ScannedFile,
} from './models';

const DEFAULT_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const BINARY_SAMPLE_SIZE_BYTES = 8 * 1024;

export class RepositoryScanner {
  public constructor(
    private readonly fileSystem: RepositoryFileSystem,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async scan(
    options: ScanRepositoryOptions = {},
  ): Promise<RepositoryScan> {
    const suppliedRootPath = options.rootPath ?? process.cwd();
    const resolvedRootPath = this.fileSystem.resolvePath(suppliedRootPath);
    const maxFileSizeBytes =
      options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;

    if (!Number.isSafeInteger(maxFileSizeBytes) || maxFileSizeBytes < 0) {
      throw new RepositoryScanError(
        'Maximum file size must be a non-negative safe integer.',
      );
    }

    try {
      const metadata = await this.fileSystem.getMetadata(resolvedRootPath);
      if (metadata.type !== 'directory') {
        throw new InvalidRepositoryError(resolvedRootPath);
      }

      const rootPath = await this.fileSystem.canonicalPath(resolvedRootPath);
      const [gitIgnoreContents, latticeIgnoreContents] = await Promise.all([
        this.fileSystem.readOptionalText(path.join(rootPath, '.gitignore')),
        this.fileSystem.readOptionalText(path.join(rootPath, '.latticeignore')),
      ]);
      const ignoreRules = IgnoreRules.fromFiles(
        gitIgnoreContents,
        latticeIgnoreContents,
      );

      const files: ScannedFile[] = [];
      let totalDirectories = 0;
      let totalIgnoredEntries = 0;

      const shouldIgnore = (
        relativePath: string,
        type: 'directory' | 'file' | 'symbolic-link' | 'other',
      ): boolean => {
        const ignored = ignoreRules.ignores(relativePath, type);
        if (ignored) {
          totalIgnoredEntries += 1;
        }
        return ignored;
      };

      for await (const entry of this.fileSystem.walkDirectory(rootPath, {
        shouldIgnore,
      })) {
        if (entry.type === 'directory') {
          totalDirectories += 1;
          continue;
        }
        if (entry.type !== 'file' || entry.sizeBytes > maxFileSizeBytes) {
          totalIgnoredEntries += 1;
          continue;
        }

        const content = await this.fileSystem.readBytes(entry.absolutePath);
        if (isBinary(content)) {
          totalIgnoredEntries += 1;
          continue;
        }

        const extension = getExtension(entry.relativePath);
        files.push({
          id: this.fileSystem.hashText(entry.relativePath),
          relativePath: entry.relativePath,
          absolutePath: entry.absolutePath,
          extension,
          language: detectLanguage(extension),
          sizeBytes: entry.sizeBytes,
          contentHash: this.fileSystem.hashBytes(content),
          lastModified: entry.lastModified,
        });
      }

      files.sort((left, right) =>
        left.relativePath.localeCompare(right.relativePath, 'en'),
      );

      return {
        rootPath,
        scannedAt: this.now(),
        totalFiles: files.length,
        totalDirectories,
        totalIgnoredEntries,
        files,
      };
    } catch (error: unknown) {
      throw mapScanError(error, resolvedRootPath);
    }
  }
}

export async function scanRepository(
  options: ScanRepositoryOptions = {},
): Promise<RepositoryScan> {
  return new RepositoryScanner(new NodeRepositoryFileSystem()).scan(options);
}

function getExtension(relativePath: string): string | null {
  const extension = path.posix.extname(relativePath).toLowerCase();
  return extension === '' ? null : extension;
}

function isBinary(content: Uint8Array): boolean {
  const sample = content.subarray(0, BINARY_SAMPLE_SIZE_BYTES);
  if (sample.includes(0)) {
    return true;
  }

  let controlCharacterCount = 0;
  for (const byte of sample) {
    const isAllowedWhitespace =
      byte === 9 || byte === 10 || byte === 12 || byte === 13;
    if (byte < 32 && !isAllowedWhitespace) {
      controlCharacterCount += 1;
    }
  }
  return sample.length > 0 && controlCharacterCount / sample.length > 0.3;
}

function mapScanError(
  error: unknown,
  repositoryPath: string,
): RepositoryScanError {
  if (error instanceof RepositoryScanError) {
    return error;
  }
  if (error instanceof FileSystemAccessError) {
    if (error.code === 'not-found') {
      return new RepositoryNotFoundError(repositoryPath, { cause: error });
    }
    if (error.code === 'permission-denied') {
      return new PermissionDeniedError(repositoryPath, { cause: error });
    }
    return new RepositoryScanError(
      `Could not scan repository: ${repositoryPath}`,
      { cause: error },
    );
  }
  return new RepositoryScanError(
    `Could not scan repository: ${repositoryPath}`,
    {
      cause: error,
    },
  );
}
