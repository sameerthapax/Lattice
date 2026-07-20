export class ParserInitializationError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ParserInitializationError';
  }
}

export class SourceReadError extends Error {
  public constructor(
    public readonly relativePath: string,
    options?: ErrorOptions,
  ) {
    super(`Could not read source file: ${relativePath}`, options);
    this.name = 'SourceReadError';
  }
}

export class FileChangedSinceScanError extends Error {
  public constructor(public readonly relativePath: string) {
    super(`Source file changed after scanning: ${relativePath}`);
    this.name = 'FileChangedSinceScanError';
  }
}
