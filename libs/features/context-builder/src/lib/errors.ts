export type ContextBuilderInputErrorReason =
  | 'INVALID_OPTIONS'
  | 'CONTEXT_LIMIT_TOO_SMALL'
  | 'TARGET_LOOKUP_INVALID'
  | 'TARGET_NOT_FOUND'
  | 'TARGET_AMBIGUOUS'
  | 'SCAN_ANALYSIS_MISMATCH'
  | 'SCAN_RESOLUTION_MISMATCH'
  | 'SCAN_KNOWLEDGE_MISMATCH'
  | 'KNOWLEDGE_RELATION_INVALID'
  | 'SOURCE_PROVIDER_REQUIRED'
  | 'SOURCE_FILE_MISMATCH'
  | 'SOURCE_HASH_MISMATCH'
  | 'SOURCE_TOO_LARGE';
export class ContextBuilderInputError extends Error {
  public constructor(
    message: string,
    public readonly reason: ContextBuilderInputErrorReason,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ContextBuilderInputError';
  }
}
export class ContextTargetNotFoundError extends ContextBuilderInputError {
  public constructor(message: string) {
    super(message, 'TARGET_NOT_FOUND');
    this.name = 'ContextTargetNotFoundError';
  }
}
export class ContextTargetAmbiguousError extends ContextBuilderInputError {
  public constructor(message: string) {
    super(message, 'TARGET_AMBIGUOUS');
    this.name = 'ContextTargetAmbiguousError';
  }
}
export class ContextSourceIntegrityError extends ContextBuilderInputError {
  public constructor(
    message: string,
    reason:
      'SOURCE_FILE_MISMATCH' | 'SOURCE_HASH_MISMATCH' | 'SOURCE_TOO_LARGE',
    options?: ErrorOptions,
  ) {
    super(message, reason, options);
    this.name = 'ContextSourceIntegrityError';
  }
}
