import * as Schema from "effect/Schema";
import { ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

export const ExistingThread = Schema.Struct({
  id: TrimmedNonEmptyString,
  sessionId: TrimmedNonEmptyString,
  source: Schema.Literals(["official-t3", "provider-cli"]),
  provider: Schema.Literals(["codex", "claudeAgent"]),
  instanceId: ProviderInstanceId,
  title: Schema.String,
  cwd: Schema.String,
  updatedAt: Schema.String,
  unavailableReason: Schema.NullOr(Schema.String),
  importedThreadId: Schema.NullOr(ThreadId),
});
export type ExistingThread = typeof ExistingThread.Type;
export const ExistingThreadListInput = Schema.Struct({ instanceId: ProviderInstanceId });
export const ExistingThreadListResult = Schema.Struct({
  threads: Schema.Array(ExistingThread),
  notices: Schema.Array(Schema.String),
});
export const ExistingThreadImportInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  id: TrimmedNonEmptyString,
  sessionReleased: Schema.Literal(true),
});
export const ExistingThreadImportResult = Schema.Struct({ threadId: ThreadId });
export class ExistingThreadError extends Schema.TaggedErrorClass<ExistingThreadError>()(
  "ExistingThreadError",
  { detail: Schema.String },
) {
  override get message() {
    return this.detail;
  }
}

export type ExistingThreadListInput = typeof ExistingThreadListInput.Type;
export type ExistingThreadImportInput = typeof ExistingThreadImportInput.Type;
