import type { SupportedLanguage } from './language';

export interface RepositoryScan {
  readonly rootPath: string;
  readonly scannedAt: Date;
  readonly totalFiles: number;
  readonly totalDirectories: number;
  readonly totalIgnoredEntries: number;
  readonly files: readonly ScannedFile[];
}

export interface ScannedFile {
  readonly id: string;
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly extension: string | null;
  readonly language: SupportedLanguage;
  readonly sizeBytes: number;
  readonly contentHash: string;
  readonly lastModified: Date;
}

export interface ScanRepositoryOptions {
  readonly rootPath?: string;
  readonly maxFileSizeBytes?: number;
}
