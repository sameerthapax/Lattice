import type { ScannedFile } from '@lattice/core-indexer';
import type { RepositoryFileSystem } from '@lattice/filesystem';

import { FileChangedSinceScanError, SourceReadError } from './errors';
import { extractSourceFile } from './extract-source-file';
import { toParseableLanguage } from './language';
import type {
  AnalyzeRepositoryOptions,
  ParseFailure,
  ParsedSourceFile,
  RepositoryAnalysis,
} from './models';
import {
  TreeSitterParserRegistry,
  type SyntaxParserRegistry,
} from './tree-sitter-adapter';

export class RepositoryAnalyzer {
  public constructor(
    private readonly fileSystem: RepositoryFileSystem,
    private readonly now: () => Date = () => new Date(),
    private readonly parsers: SyntaxParserRegistry = new TreeSitterParserRegistry(),
  ) {}

  public async analyze(
    scan: AnalyzeRepositoryOptions['scan'],
  ): Promise<RepositoryAnalysis> {
    const files: ParsedSourceFile[] = [];
    const failures: ParseFailure[] = [];
    let skippedFileCount = 0;

    for (const scannedFile of scan.files) {
      const language = toParseableLanguage(scannedFile.language);
      if (language === null) {
        skippedFileCount += 1;
        continue;
      }

      try {
        const contentBytes = await this.readVerifiedContent(scannedFile);
        const tree = this.parsers.parse(
          language,
          contentBytes.toString('utf8'),
        );
        files.push(
          extractSourceFile({
            fileId: scannedFile.id,
            relativePath: scannedFile.relativePath,
            language,
            contentHash: scannedFile.contentHash,
            rootNode: tree.rootNode,
            hashText: (content) => this.fileSystem.hashText(content),
          }),
        );
      } catch (error: unknown) {
        failures.push(toParseFailure(scannedFile, error));
      }
    }

    files.sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath, 'en'),
    );
    failures.sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath, 'en'),
    );

    return {
      rootPath: scan.rootPath,
      analyzedAt: this.now(),
      scannedFileCount: scan.files.length,
      parsedFileCount: files.length,
      skippedFileCount,
      failedFileCount: failures.length,
      files,
      failures,
    };
  }

  private async readVerifiedContent(scannedFile: ScannedFile): Promise<Buffer> {
    let content: Buffer;
    try {
      content = await this.fileSystem.readBytes(scannedFile.absolutePath);
    } catch (error: unknown) {
      throw new SourceReadError(scannedFile.relativePath, { cause: error });
    }
    if (this.fileSystem.hashBytes(content) !== scannedFile.contentHash) {
      throw new FileChangedSinceScanError(scannedFile.relativePath);
    }
    return content;
  }
}

export async function analyzeRepository(
  options: AnalyzeRepositoryOptions,
): Promise<RepositoryAnalysis> {
  return new RepositoryAnalyzer(options.fileSystem, options.now).analyze(
    options.scan,
  );
}

function toParseFailure(file: ScannedFile, error: unknown): ParseFailure {
  if (error instanceof FileChangedSinceScanError) {
    return {
      fileId: file.id,
      relativePath: file.relativePath,
      code: 'FILE_CHANGED_SINCE_SCAN',
      message: error.message,
    };
  }
  if (error instanceof SourceReadError) {
    return {
      fileId: file.id,
      relativePath: file.relativePath,
      code: 'SOURCE_READ_FAILED',
      message: error.message,
    };
  }
  return {
    fileId: file.id,
    relativePath: file.relativePath,
    code: 'SOURCE_PARSE_FAILED',
    message: `Could not parse source file: ${file.relativePath}`,
  };
}
