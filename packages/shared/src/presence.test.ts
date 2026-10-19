import { describe, expect, it } from "vitest";
import { computePresence, strongestPresence, type SessionEvidence } from "./presence.js";

const now = new Date("2026-10-18T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
const base: SessionEvidence = {
  hasHooks: true,
  startedAt: ago(60 * 60_000),
  endedAt: null,
  lastEventAt: null,
  lastEventType: null,
};

describe("computePresence", () => {
  it("sem hooks, chamada recente ao Cooper é online, nunca executando", () => {
    expect(computePresence({ ...base, hasHooks: false, lastEventAt: ago(1000), lastEventType: "post_tool_use" }, now)).toBe("online");
    expect(computePresence({ ...base, hasHooks: false, lastEventAt: ago(1000), lastEventType: "get_my_tasks" }, now)).toBe("online");
  });

  it("sem hooks, chamada antiga ou sessão encerrada é inativo", () => {
    expect(computePresence({ ...base, hasHooks: false, lastEventAt: ago(31 * 60_000), lastEventType: "get_my_tasks" }, now)).toBe("idle");
    expect(computePresence({ ...base, hasHooks: false, lastEventAt: ago(30_000), lastEventType: "get_my_tasks", endedAt: ago(10_000) }, now)).toBe("idle");
  });

  it("sem hooks e sem nenhuma chamada é desconhecido", () => {
    expect(computePresence({ ...base, hasHooks: false }, now)).toBe("unknown");
  });

  it("evento de execução recente é executando", () => {
    expect(computePresence({ ...base, lastEventAt: ago(60_000), lastEventType: "pre_tool_use" }, now)).toBe("running");
  });

  it("evento recente que não é de execução é online", () => {
    expect(computePresence({ ...base, lastEventAt: ago(60_000), lastEventType: "stop" }, now)).toBe("online");
  });

  it("execução antiga cai para online e depois para inativo", () => {
    expect(computePresence({ ...base, lastEventAt: ago(5 * 60_000), lastEventType: "post_tool_use" }, now)).toBe("online");
    expect(computePresence({ ...base, lastEventAt: ago(31 * 60_000), lastEventType: "post_tool_use" }, now)).toBe("idle");
  });

  it("sessão encerrada depois do último evento é inativo", () => {
    expect(computePresence({ ...base, lastEventAt: ago(30_000), lastEventType: "post_tool_use", endedAt: ago(10_000) }, now)).toBe("idle");
  });

  it("sessão sem nenhum evento é inativo", () => {
    expect(computePresence(base, now)).toBe("idle");
  });

  it("relógio adiantado não quebra", () => {
    expect(computePresence({ ...base, lastEventAt: ago(-5000), lastEventType: "pre_tool_use" }, now)).toBe("running");
  });
});

describe("strongestPresence", () => {
  it("escolhe o status mais forte", () => {
    expect(strongestPresence(["idle", "running", "online"])).toBe("running");
    expect(strongestPresence([])).toBe("unknown");
  });
});
