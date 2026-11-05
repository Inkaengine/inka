export type QueryVocabulary = {
  pathIndex: string;
  pathOperator: string;
  sortOn: string;
};

export declare const PATH_INDEX_TOKEN: string;
export declare const PATH_OP_TOKEN: string;
export declare const SORT_ON_TOKEN: string;
export declare const VOCABULARIES: Record<string, QueryVocabulary>;
export declare function projectQueryVocabulary<T>(
  documents: T[],
  vocabulary: QueryVocabulary,
): T[];
