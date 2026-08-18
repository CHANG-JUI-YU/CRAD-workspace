import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("node:child_process", () => ({ spawn: spawnMock }));

import { openDashboardBrowser } from "../src/dashboard-launcher.js";

describe("Dashboard Windows browser launcher", () => {
  it.skipIf(process.platform !== "win32")("uses rundll32.exe with the expected URL handler without opening a real browser", async () => {
    spawnMock.mockReset();
    const unref = vi.fn();
    const child = Object.assign(new EventEmitter(), { unref });
    spawnMock.mockImplementationOnce(() => {
      queueMicrotask(() => child.emit("spawn"));
      return child;
    });

    const url = "http://127.0.0.1:9876/";
    await openDashboardBrowser(url);

    expect(spawnMock).toHaveBeenCalledOnce();
    expect(spawnMock).toHaveBeenCalledWith(
      "rundll32.exe",
      ["url.dll,FileProtocolHandler", url],
      {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      },
    );
    expect(unref).toHaveBeenCalledOnce();
  });
});
