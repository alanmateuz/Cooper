import { describe, expect, it } from "vitest";
import { compact, relativeTime } from "./compact";

const now = new Date("2026-10-19T12:00:00Z");

describe("compact", () => {
  it("tira null, vazio e listas vazias, recursivamente", () => {
    expect(compact({ a: null, b: "", c: [], d: { e: null, f: [null, "", "x"] }, g: "ok" }, now)).toEqual({ d: { f: ["x"] }, g: "ok" });
  });

  it("mantém false e 0", () => {
    expect(compact({ assigned_to_you: false, uncommitted: 0 }, now)).toEqual({ assigned_to_you: false, uncommitted: 0 });
  });

  it("troca datas ISO por tempo relativo", () => {
    expect(compact({ at: "2026-10-19T11:55:00Z", resets: "2026-10-19T14:00:00.000+00:00" }, now)).toEqual({ at: "há 5 min", resets: "em 2 h" });
  });

  it("não mexe em texto que só parece data", () => {
    expect(compact({ text: "2026-10-19 reunião" }, now)).toEqual({ text: "2026-10-19 reunião" });
  });
});

describe("relativeTime", () => {
  it("minutos, horas e dias", () => {
    expect(relativeTime("2026-10-19T12:00:20Z", now)).toBe("agora");
    expect(relativeTime("2026-10-19T09:00:00Z", now)).toBe("há 3 h");
    expect(relativeTime("2026-10-15T12:00:00Z", now)).toBe("há 4 d");
  });
});
