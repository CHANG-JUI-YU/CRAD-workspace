import { EventEmitter } from "node:events";

import type { FastifyReply } from "fastify";
import { dashboardEventSchema, type DashboardEvent } from "@card-workspace/schemas";

export class DashboardEvents {
  private readonly emitter = new EventEmitter();

  publish(event: DashboardEvent): void {
    this.emitter.emit("event", dashboardEventSchema.parse(event));
  }

  subscribe(reply: FastifyReply): () => void {
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    reply.raw.write(": connected\n\n");
    const listener = (event: DashboardEvent) => reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    this.emitter.on("event", listener);
    const heartbeat = setInterval(() => reply.raw.write(": heartbeat\n\n"), 15_000);
    const close = () => {
      clearInterval(heartbeat);
      this.emitter.off("event", listener);
    };
    reply.raw.once("close", close);
    return close;
  }
}
