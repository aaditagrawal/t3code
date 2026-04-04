import { Schema } from "effect";
import { fromLenientJson } from "./schemaJson";

/** Narrow schema that only decodes the observability subtree, avoiding
 *  validation failures from unrelated ServerSettings fields. */
const ObservabilitySubtreeJson = fromLenientJson(
  Schema.Struct({
    observability: Schema.optional(
      Schema.Struct({
        otlpTracesUrl: Schema.optional(Schema.String),
        otlpMetricsUrl: Schema.optional(Schema.String),
      }),
    ),
  }),
);

export interface PersistedServerObservabilitySettings {
  readonly otlpTracesUrl: string | undefined;
  readonly otlpMetricsUrl: string | undefined;
}

export function normalizePersistedServerSettingString(
  value: string | null | undefined,
): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function extractPersistedServerObservabilitySettings(input: {
  readonly observability?:
    | {
        readonly otlpTracesUrl?: string | undefined;
        readonly otlpMetricsUrl?: string | undefined;
      }
    | undefined;
}): PersistedServerObservabilitySettings {
  return {
    otlpTracesUrl: normalizePersistedServerSettingString(input.observability?.otlpTracesUrl),
    otlpMetricsUrl: normalizePersistedServerSettingString(input.observability?.otlpMetricsUrl),
  };
}

export function parsePersistedServerObservabilitySettings(
  raw: string,
): PersistedServerObservabilitySettings {
  try {
    const decoded = Schema.decodeUnknownSync(ObservabilitySubtreeJson)(raw);
    return extractPersistedServerObservabilitySettings(decoded);
  } catch {
    return { otlpTracesUrl: undefined, otlpMetricsUrl: undefined };
  }
}
