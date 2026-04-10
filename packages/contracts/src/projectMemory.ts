import { Schema } from "effect";
import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas";

const makeEntityId = <Brand extends string>(brand: Brand) =>
  TrimmedNonEmptyString.pipe(Schema.brand(brand));

export const MemoryEntryId = makeEntityId("MemoryEntryId");
export type MemoryEntryId = typeof MemoryEntryId.Type;

export const MemoryKind = Schema.Literals([
  "architectural-decision",
  "code-pattern",
  "bug-fix",
  "convention",
  "dependency-note",
  "session-insight",
  "file-summary",
  "custom",
]);
export type MemoryKind = typeof MemoryKind.Type;

export const MemoryEntry = Schema.Struct({
  id: MemoryEntryId,
  projectId: ProjectId,
  threadId: Schema.NullOr(ThreadId),
  kind: MemoryKind,
  title: TrimmedNonEmptyString,
  content: TrimmedNonEmptyString,
  tags: Schema.Array(TrimmedNonEmptyString),
  relevanceScore: Schema.Number.check(
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(1),
  ).pipe(Schema.withDecodingDefault(() => 0.5)),
  accessCount: NonNegativeInt.pipe(Schema.withDecodingDefault(() => 0)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  expiresAt: Schema.NullOr(IsoDateTime),
});
export type MemoryEntry = typeof MemoryEntry.Type;

export const MemorySearchResult = Schema.Struct({
  entry: MemoryEntry,
  matchScore: Schema.Number,
  matchSnippet: Schema.NullOr(Schema.String),
});
export type MemorySearchResult = typeof MemorySearchResult.Type;

export const MemoryIndexInput = Schema.Struct({
  projectId: ProjectId,
  forceReindex: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
});
export type MemoryIndexInput = typeof MemoryIndexInput.Type;

export const MemoryIndexResult = Schema.Struct({
  entriesIndexed: NonNegativeInt,
  duration: NonNegativeInt,
});
export type MemoryIndexResult = typeof MemoryIndexResult.Type;

export const MemorySearchInput = Schema.Struct({
  projectId: ProjectId,
  query: TrimmedNonEmptyString,
  kind: Schema.optional(MemoryKind),
  tags: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  limit: NonNegativeInt.pipe(Schema.withDecodingDefault(() => 10)),
});
export type MemorySearchInput = typeof MemorySearchInput.Type;

export const MemorySearchOutput = Schema.Struct({
  results: Schema.Array(MemorySearchResult),
  queryTime: NonNegativeInt,
});
export type MemorySearchOutput = typeof MemorySearchOutput.Type;

export const MemoryAddInput = Schema.Struct({
  projectId: ProjectId,
  threadId: Schema.optional(ThreadId),
  kind: MemoryKind,
  title: TrimmedNonEmptyString,
  content: TrimmedNonEmptyString,
  tags: Schema.Array(TrimmedNonEmptyString),
  expiresAt: Schema.optional(IsoDateTime),
});
export type MemoryAddInput = typeof MemoryAddInput.Type;

export const MemoryForgetInput = Schema.Struct({
  entryId: MemoryEntryId,
});
export type MemoryForgetInput = typeof MemoryForgetInput.Type;

export const MemoryListInput = Schema.Struct({
  projectId: ProjectId,
  kind: Schema.optional(MemoryKind),
  limit: NonNegativeInt.pipe(Schema.withDecodingDefault(() => 50)),
  offset: NonNegativeInt.pipe(Schema.withDecodingDefault(() => 0)),
});
export type MemoryListInput = typeof MemoryListInput.Type;

export const MemoryListResult = Schema.Struct({
  entries: Schema.Array(MemoryEntry),
  total: NonNegativeInt,
});
export type MemoryListResult = typeof MemoryListResult.Type;

export class ProjectMemoryError extends Schema.TaggedErrorClass<ProjectMemoryError>()(
  "ProjectMemoryError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}
