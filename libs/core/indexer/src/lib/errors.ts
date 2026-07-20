export class RepositoryScanError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RepositoryScanError';
  }
}

export class RepositoryNotFoundError extends RepositoryScanError {
  public constructor(repositoryPath: string, options?: ErrorOptions) {
    super(`Repository path does not exist: ${repositoryPath}`, options);
    this.name = 'RepositoryNotFoundError';
  }
}

export class InvalidRepositoryError extends RepositoryScanError {
  public constructor(repositoryPath: string, options?: ErrorOptions) {
    super(`Repository path is not a directory: ${repositoryPath}`, options);
    this.name = 'InvalidRepositoryError';
  }
}

export class PermissionDeniedError extends RepositoryScanError {
  public constructor(repositoryPath: string, options?: ErrorOptions) {
    super(
      `Permission denied while scanning repository: ${repositoryPath}`,
      options,
    );
    this.name = 'PermissionDeniedError';
  }
}
