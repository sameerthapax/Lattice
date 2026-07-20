import { createHash } from 'node:crypto';
import { lstat, open, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

export type EntryType = 'directory' | 'file' | 'symbolic-link' | 'other';

export interface EntryMetadata {
  readonly type: EntryType;
  readonly sizeBytes: number;
  readonly lastModified: Date;
}

export interface DirectoryEntry extends EntryMetadata {
  readonly absolutePath: string;
  readonly relativePath: string;
}

export interface WalkOptions {
  readonly shouldIgnore: (relativePath: string, type: EntryType) => boolean;
}

export interface RepositoryFileSystem {
  resolvePath(inputPath: string): string;
  canonicalPath(inputPath: string): Promise<string>;
  getMetadata(inputPath: string): Promise<EntryMetadata>;
  walkDirectory(
    rootPath: string,
    options: WalkOptions,
  ): AsyncIterable<DirectoryEntry>;
  readBytes(filePath: string): Promise<Buffer>;
  readOptionalText(filePath: string): Promise<string | null>;
  hashBytes(content: Uint8Array): string;
  hashText(content: string): string;
}

export type FileSystemErrorCode =
  'not-found' | 'permission-denied' | 'invalid-entry' | 'unknown';

export class FileSystemAccessError extends Error {
  public constructor(
    message: string,
    public readonly code: FileSystemErrorCode,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'FileSystemAccessError';
  }
}

export class NodeRepositoryFileSystem implements RepositoryFileSystem {
  public resolvePath(inputPath: string): string {
    return path.resolve(inputPath);
  }

  public async canonicalPath(inputPath: string): Promise<string> {
    try {
      return await realpath(inputPath);
    } catch (error: unknown) {
      throw wrapFileSystemError(error, `Cannot resolve path: ${inputPath}`);
    }
  }

  public async getMetadata(inputPath: string): Promise<EntryMetadata> {
    try {
      const stats = await lstat(inputPath);
      return {
        type: stats.isDirectory()
          ? 'directory'
          : stats.isFile()
            ? 'file'
            : stats.isSymbolicLink()
              ? 'symbolic-link'
              : 'other',
        sizeBytes: stats.size,
        lastModified: stats.mtime,
      };
    } catch (error: unknown) {
      throw wrapFileSystemError(error, `Cannot inspect path: ${inputPath}`);
    }
  }

  public async *walkDirectory(
    rootPath: string,
    options: WalkOptions,
  ): AsyncIterable<DirectoryEntry> {
    yield* this.walk(rootPath, '', options);
  }

  public async readBytes(filePath: string): Promise<Buffer> {
    try {
      return await readFile(filePath);
    } catch (error: unknown) {
      throw wrapFileSystemError(error, `Cannot read file: ${filePath}`);
    }
  }

  public async readOptionalText(filePath: string): Promise<string | null> {
    let handle;
    try {
      handle = await open(filePath, 'r');
      return await handle.readFile({ encoding: 'utf8' });
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return null;
      }
      throw wrapFileSystemError(error, `Cannot read ignore file: ${filePath}`);
    } finally {
      await handle?.close();
    }
  }

  public hashBytes(content: Uint8Array): string {
    return createHash('sha256').update(content).digest('hex');
  }

  public hashText(content: string): string {
    return createHash('sha256').update(content, 'utf8').digest('hex');
  }

  private async *walk(
    rootPath: string,
    relativeDirectory: string,
    options: WalkOptions,
  ): AsyncIterable<DirectoryEntry> {
    const absoluteDirectory = path.join(rootPath, relativeDirectory);
    let names: string[];

    try {
      names = await readdir(absoluteDirectory);
    } catch (error: unknown) {
      throw wrapFileSystemError(
        error,
        `Cannot read directory: ${absoluteDirectory}`,
      );
    }

    names.sort((left, right) => left.localeCompare(right, 'en'));

    for (const name of names) {
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${name}`
        : name;
      const absolutePath = path.join(rootPath, ...relativePath.split('/'));
      const metadata = await this.getMetadata(absolutePath);

      if (options.shouldIgnore(relativePath, metadata.type)) {
        continue;
      }

      const entry: DirectoryEntry = {
        ...metadata,
        absolutePath,
        relativePath,
      };
      yield entry;

      if (metadata.type === 'directory') {
        yield* this.walk(rootPath, relativePath, options);
      }
    }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function wrapFileSystemError(
  error: unknown,
  message: string,
): FileSystemAccessError {
  if (error instanceof FileSystemAccessError) {
    return error;
  }

  const code = isNodeError(error)
    ? error.code === 'ENOENT'
      ? 'not-found'
      : error.code === 'EACCES' || error.code === 'EPERM'
        ? 'permission-denied'
        : error.code === 'ENOTDIR' || error.code === 'EISDIR'
          ? 'invalid-entry'
          : 'unknown'
    : 'unknown';

  return new FileSystemAccessError(message, code, { cause: error });
}
