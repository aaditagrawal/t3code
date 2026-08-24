import type {
  ProviderUserInputAnswers,
  UserInputQuestion,
  UserInputQuestionOption,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as EffectAcpSchema from "effect-acp/schema";

type FormRequest = Extract<EffectAcpSchema.ElicitationRequest, { readonly mode: "form" }>;
type Property = EffectAcpSchema.ElicitationPropertySchema;

const LegacyEnumOption = Schema.Struct({
  const: Schema.String,
  title: Schema.String,
  description: Schema.optionalKey(Schema.Union([Schema.String, Schema.Null])),
});
const LegacyPropertyOptions = Schema.Struct({
  oneOf: Schema.optionalKey(Schema.Union([Schema.Array(LegacyEnumOption), Schema.Null])),
  items: Schema.optionalKey(
    Schema.Struct({
      anyOf: Schema.optionalKey(Schema.Array(LegacyEnumOption)),
    }),
  ),
});
const LegacyElicitationOptionDescriptions = Schema.Struct({
  requestedSchema: Schema.Struct({
    properties: Schema.optionalKey(Schema.Record(Schema.String, LegacyPropertyOptions)),
  }),
});
const decodeLegacyElicitationOptionDescriptions = Schema.decodeUnknownOption(
  LegacyElicitationOptionDescriptions,
);

function nonEmpty(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function enumEntries(property: Property): ReadonlyArray<{
  readonly label: string;
  readonly value: string;
}> {
  if (property.type === "string") {
    if (property.oneOf) {
      return property.oneOf.map((option) => ({
        label: nonEmpty(option.title) ?? option.const,
        value: option.const,
      }));
    }
    return (property.enum ?? []).map((value) => ({ label: value, value }));
  }
  if (property.type !== "array") return [];
  if ("enum" in property.items) {
    return property.items.enum.map((value) => ({ label: value, value }));
  }
  return property.items.anyOf.map((option) => ({
    label: nonEmpty(option.title) ?? option.const,
    value: option.const,
  }));
}

function optionDescriptionsByQuestion(
  rawRequest: unknown,
): ReadonlyMap<string, ReadonlyMap<string, string>> {
  const decoded = decodeLegacyElicitationOptionDescriptions(rawRequest);
  if (Option.isNone(decoded)) return new Map();
  const result = new Map<string, ReadonlyMap<string, string>>();
  for (const [id, property] of Object.entries(decoded.value.requestedSchema.properties ?? {})) {
    const descriptions = new Map<string, string>();
    for (const option of property.oneOf ?? property.items?.anyOf ?? []) {
      const description = nonEmpty(option.description);
      if (description) descriptions.set(option.const, description);
    }
    if (descriptions.size > 0) result.set(id, descriptions);
  }
  return result;
}

function questionOptions(
  property: Property,
  descriptions: ReadonlyMap<string, string> | undefined,
): ReadonlyArray<UserInputQuestionOption> {
  if (property.type === "boolean") {
    return [
      { label: "Yes", description: "Yes" },
      { label: "No", description: "No" },
    ];
  }
  return enumEntries(property).map((option) => ({
    label: option.label,
    description: descriptions?.get(option.value) ?? option.label,
  }));
}

function visibleFormProperties(request: FormRequest) {
  const properties = request.requestedSchema.properties ?? {};
  return Object.entries(properties).filter(([id]) => {
    if (!id.endsWith("__other")) return true;
    return !(id.slice(0, -"__other".length) in properties);
  });
}

export function extractStandardAcpFormQuestions(
  request: EffectAcpSchema.ElicitationRequest,
  rawRequest: unknown = request,
): ReadonlyArray<UserInputQuestion> {
  if (request.mode !== "form") return [];
  const formTitle = nonEmpty(request.requestedSchema.title);
  const optionDescriptions = optionDescriptionsByQuestion(rawRequest);
  return visibleFormProperties(request).map(([id, property]) => {
    const title = nonEmpty(property.title);
    const description = nonEmpty(property.description);
    return {
      id,
      header: formTitle ?? (title ? (description ?? title) : "Question"),
      question: title ?? request.message,
      options: questionOptions(property, optionDescriptions.get(id)),
      multiSelect: property.type === "array",
    };
  });
}

function answerValues(answer: unknown): ReadonlyArray<string> {
  if (Array.isArray(answer)) {
    return answer.flatMap((entry) =>
      typeof entry === "string" && entry.trim() ? [entry.trim()] : [],
    );
  }
  return typeof answer === "string" && answer.trim() ? [answer.trim()] : [];
}

function contentValue(
  property: Property,
  answer: unknown,
): EffectAcpSchema.ElicitationContentValue | undefined {
  const values = answerValues(answer);
  switch (property.type) {
    case "array": {
      const choices = new Map(
        enumEntries(property).flatMap((entry) => [
          [entry.label, entry.value] as const,
          [entry.value, entry.value] as const,
        ]),
      );
      return values.length > 0 ? values.flatMap((value) => choices.get(value) ?? []) : undefined;
    }
    case "boolean": {
      if (typeof answer === "boolean") return answer;
      const normalized = values[0]?.toLowerCase();
      if (normalized === "yes" || normalized === "true") return true;
      if (normalized === "no" || normalized === "false") return false;
      return undefined;
    }
    case "integer":
    case "number": {
      if (typeof answer === "number" && Number.isFinite(answer)) {
        return property.type === "integer" ? Math.trunc(answer) : answer;
      }
      const parsed = Number(values[0]);
      if (!Number.isFinite(parsed)) return undefined;
      return property.type === "integer" ? Math.trunc(parsed) : parsed;
    }
    case "string": {
      const value = values[0];
      if (value === undefined) return undefined;
      const choices = new Map(
        enumEntries(property).flatMap((entry) => [
          [entry.label, entry.value] as const,
          [entry.value, entry.value] as const,
        ]),
      );
      return choices.size > 0 ? choices.get(value) : value;
    }
  }
}

export function makeStandardAcpFormAcceptedResponse(
  request: FormRequest,
  answers: ProviderUserInputAnswers,
): EffectAcpSchema.ElicitationResponse {
  const properties = request.requestedSchema.properties ?? {};
  const content: Record<string, EffectAcpSchema.ElicitationContentValue> = {};
  for (const [id, property] of visibleFormProperties(request)) {
    const answer = answers[id];
    const companionId = `${id}__other`;
    const companion = properties[companionId];
    const allowed = new Set(enumEntries(property).flatMap((entry) => [entry.label, entry.value]));
    const values = answerValues(answer);
    if (
      companion?.type === "string" &&
      values.length > 0 &&
      !values.every((value) => allowed.has(value))
    ) {
      content[companionId] = values.join("\n");
      continue;
    }
    const encoded = contentValue(property, answer);
    if (encoded !== undefined) content[id] = encoded;
  }
  return { action: { action: "accept", content } };
}

export function makeStandardAcpFormCancelledResponse(): EffectAcpSchema.ElicitationResponse {
  return { action: { action: "cancel" } };
}

export function makeStandardAcpFormDeclinedResponse(): EffectAcpSchema.ElicitationResponse {
  return { action: { action: "decline" } };
}
