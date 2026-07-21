export type ResolverInputErrorCode =
  | 'DUPLICATE_FILE_ID'
  | 'DUPLICATE_FILE_PATH'
  | 'DUPLICATE_ENTITY_ID'
  | 'UNKNOWN_ANALYSIS_FILE'
  | 'MALFORMED_WORKSPACE_ALIAS';

export class ResolverInputError extends Error {
  public constructor(
    public readonly code: ResolverInputErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ResolverInputError';
  }
}
