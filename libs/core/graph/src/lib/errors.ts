export type RepositoryGraphInputErrorCode =
  | 'DUPLICATE_NODE_ID'
  | 'DUPLICATE_RELATION_ID'
  | 'INVALID_NODE_KIND'
  | 'INVALID_RELATION_KIND'
  | 'MISSING_RELATION_ENDPOINT'
  | 'INCONSISTENT_ENDPOINT_KINDS'
  | 'TARGET_NODE_NOT_FOUND'
  | 'INVALID_PROJECTION_OPTIONS';

export class RepositoryGraphInputError extends Error {
  public constructor(
    public readonly code: RepositoryGraphInputErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RepositoryGraphInputError';
  }
}
