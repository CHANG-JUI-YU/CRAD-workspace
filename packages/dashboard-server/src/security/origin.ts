import type { FastifyRequest } from "fastify";

import { dashboardFail } from "../errors.js";

const loopbackHost = /^127\.0\.0\.1(?::\d{1,5})?$/;

export function assertLoopbackRequest(request: FastifyRequest, requireOrigin: boolean): void {
  const host = request.headers.host;
  if (host === undefined || !loopbackHost.test(host)) {
    dashboardFail("DASHBOARD_HOST_DENIED", "Dashboard only accepts the active IPv4 loopback host", 403);
  }
  if (!requireOrigin) return;
  const origin = request.headers.origin;
  if (origin !== `http://${host}`) {
    dashboardFail("DASHBOARD_ORIGIN_DENIED", "Request Origin does not match the dashboard loopback origin", 403);
  }
}
