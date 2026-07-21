export type KnowledgeBuilderInputErrorCode =
  | 'ANALYSIS_FILE_NOT_SCANNED'
  | 'RESOLUTION_FILE_NOT_SCANNED'
  | 'DUPLICATE_PROJECT_NAME'
  | 'DUPLICATE_PROJECT_ROOT'
  | 'PROJECT_PATH_ESCAPES_REPOSITORY'
  | 'SOURCE_ROOT_OUTSIDE_PROJECT'
  | 'ENTRY_POINT_OUTSIDE_PROJECT'
  | 'ENTRY_POINT_NOT_SCANNED'
  | 'DUPLICATE_NODE_ID'
  | 'MISSING_RELATION_NODE';

export class KnowledgeBuilderInputError extends Error {
  public constructor(
    public readonly code: KnowledgeBuilderInputErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'KnowledgeBuilderInputError';
  }
}
