// @effect-diagnostics nodeBuiltinImport:off
import * as NodeReadline from "node:readline";
import * as Schema from "effect/Schema";

const Packet = Schema.Struct({
  id: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
  method: Schema.optional(Schema.String),
  params: Schema.optional(Schema.Record(Schema.String, Schema.Json)),
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.Unknown),
});
const decodePacket = Schema.decodeUnknownSync(Schema.fromJsonString(Packet));
type Handler = (params: Readonly<Record<string, Schema.Json>>) => unknown | Promise<unknown>;

/** A real ACP v1 wire peer, independent of the production SDK's v2 agent API. */
export function makeV1FixtureAgent() {
  const handlers = new Map<string, Handler>();
  const pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (cause: unknown) => void }
  >();
  let sequence = 0;
  const write = (packet: unknown) => process.stdout.write(`${JSON.stringify(packet)}\n`);
  return {
    handle: (method: string, handler: Handler) => handlers.set(method, handler),
    request: (method: string, params: unknown) =>
      new Promise<unknown>((resolve, reject) => {
        const id = `fixture-${++sequence}`;
        pending.set(id, { resolve, reject });
        write({ jsonrpc: "2.0", id, method, params });
      }),
    start: () => {
      const input = NodeReadline.createInterface({ input: process.stdin });
      input.on("line", (line) => {
        const packet = decodePacket(line);
        if (!packet.method) {
          const key = String(packet.id);
          const response = pending.get(key);
          if (response) {
            pending.delete(key);
            if (packet.error !== undefined) response.reject(packet.error);
            else response.resolve(packet.result);
          }
          return;
        }
        const handler = handlers.get(packet.method);
        if (!handler) {
          if (packet.id !== undefined)
            write({
              jsonrpc: "2.0",
              id: packet.id,
              error: { code: -32601, message: `Unknown method ${packet.method}` },
            });
          return;
        }
        Promise.resolve()
          .then(() => handler(packet.params ?? {}))
          .then(
            (result) => {
              if (packet.id !== undefined)
                write({ jsonrpc: "2.0", id: packet.id, result: result ?? {} });
            },
            (cause) => {
              if (packet.id !== undefined)
                write({
                  jsonrpc: "2.0",
                  id: packet.id,
                  error: { code: -32602, message: String(cause) },
                });
            },
          );
      });
      input.on("close", () => {
        for (const request of pending.values()) request.reject(new Error("Fixture input closed"));
        pending.clear();
      });
    },
  };
}
