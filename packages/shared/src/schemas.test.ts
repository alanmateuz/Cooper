import { describe, expect, it } from "vitest";
import { progressTextSchema, taskEventPayloadSchema } from "./schemas.js";

describe("taskEventPayloadSchema", () => {
  it("aceita payload de progresso válido", () => {
    expect(taskEventPayloadSchema.parse({ text: "Criando validação de QR", files: ["src/qr.ts"] })).toBeTruthy();
  });

  it("rejeita campos desconhecidos (ex.: conversa do agente)", () => {
    expect(() => taskEventPayloadSchema.parse({ text: "ok", prompt: "conteúdo da conversa" })).toThrow();
  });

  it("rejeita commit malformado", () => {
    expect(() => taskEventPayloadSchema.parse({ commit: "não-é-sha" })).toThrow();
  });
});

describe("progressTextSchema", () => {
  it("limita a 120 caracteres", () => {
    expect(() => progressTextSchema.parse("x".repeat(121))).toThrow();
    expect(progressTextSchema.parse("x".repeat(120))).toHaveLength(120);
  });
});

describe("task_edited", () => {
  it("aceita campos alterados e reaccept", () => {
    expect(taskEventPayloadSchema.parse({ fields: ["prompt", "title"], reaccept: true })).toEqual({ fields: ["prompt", "title"], reaccept: true });
  });

  it("recusa campo desconhecido", () => {
    expect(() => taskEventPayloadSchema.parse({ fields: ["status"] })).toThrow();
  });
});
