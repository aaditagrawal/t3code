import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";
const stamp = "2026-09-05T12:00:00.000Z";
const threadId = ThreadId.make("imported-test");
const projectId = ProjectId.make("project-test");
const instanceId = ProviderInstanceId.make("codex");
const command: OrchestrationCommand = {
  type: "thread.import",
  commandId: CommandId.make("import-test"),
  threadId,
  projectId,
  title: "Imported",
  modelSelection: { instanceId, model: "gpt-5.3-codex" },
  runtimeMode: "approval-required",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  createdAt: stamp,
  session: {
    threadId,
    providerName: "codex",
    providerInstanceId: instanceId,
    status: "stopped",
    runtimeMode: "approval-required",
    activeTurnId: null,
    lastError: null,
    updatedAt: stamp,
  },
  messages: [
    {
      messageId: MessageId.make("old-user"),
      role: "user",
      text: "Earlier question",
      createdAt: stamp,
    },
    {
      messageId: MessageId.make("old-answer"),
      role: "assistant",
      text: "Earlier answer",
      createdAt: stamp,
    },
  ],
};
it.layer(NodeServices.layer)("conversation import", (it) => {
  it.effect("projects history and a stopped session without requesting any provider turn", () =>
    Effect.gen(function* () {
      let model = createEmptyReadModel(stamp);
      const project = yield* decideOrchestrationCommand({
        readModel: model,
        command: {
          type: "project.create",
          commandId: CommandId.make("p"),
          projectId,
          title: "Project",
          workspaceRoot: "/tmp/project",
          createdAt: stamp,
        },
      });
      const projects = Array.isArray(project) ? project : [project];
      let sequence = 0;
      for (const event of projects)
        model = yield* projectEvent(model, { ...event, sequence: ++sequence });
      const planned = yield* decideOrchestrationCommand({ readModel: model, command });
      const events = Array.isArray(planned) ? planned : [planned];
      expect(events.map((e) => e.type)).toEqual([
        "thread.created",
        "thread.message-sent",
        "thread.message-sent",
        "thread.session-set",
      ]);
      for (const event of events)
        model = yield* projectEvent(model, { ...event, sequence: ++sequence });
      expect(model.threads[0]?.messages.map((m) => [m.role, m.text])).toEqual([
        ["user", "Earlier question"],
        ["assistant", "Earlier answer"],
      ]);
      expect(model.threads[0]?.session?.status).toBe("stopped");
      expect(model.threads[0]?.latestTurn).toBeNull();
      const duplicate = yield* decideOrchestrationCommand({ readModel: model, command }).pipe(
        Effect.exit,
      );
      expect(duplicate._tag).toBe("Failure");
    }),
  );
});
