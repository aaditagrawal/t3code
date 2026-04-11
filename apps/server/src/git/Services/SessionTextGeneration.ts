import { Context } from "effect";

import type { TextGenerationShape } from "./TextGeneration.ts";

export interface SessionTextGenerationShape extends TextGenerationShape {}

export class SessionTextGeneration extends Context.Service<
  SessionTextGeneration,
  SessionTextGenerationShape
>()("t3/git/Services/SessionTextGeneration") {}
