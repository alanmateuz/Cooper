import { describe, expect, it } from "vitest";
import { describeEvent, progressLine } from "./events";

describe("progressLine", () => {
  it("transforma sinais dos agentes em etiqueta", () => {
    expect(progressLine("LIBERA #3: branch no GitHub").tag?.label).toBe("Liberou #3");
    expect(progressLine("LIBERA #3: branch no GitHub").text).toBe("branch no GitHub");
    expect(progressLine("AGUARDANDO #1: banco").tag?.label).toBe("Aguardando #1");
    expect(progressLine("BLOQUEADO: push negado").tag?.label).toBe("Bloqueado");
    expect(progressLine("HANDOFF #4 → Ian Santiago: ver bloco Handoffs").tag?.label).toBe("Passou #4 para Ian Santiago");
    expect(progressLine("HANDOFF #4 → Ian Santiago: ver bloco Handoffs").text).toBe("ver bloco Handoffs");
  });
  it("texto comum fica como está", () => {
    expect(progressLine("Liberando memória do cache").tag).toBeUndefined();
    expect(progressLine("LIBERADO o acesso").tag).toBeUndefined();
  });
});

describe("describeEvent: coordenação (0.8)", () => {
  const name = () => "Alguém";
  it("dependência, bloqueio e disponibilidade", () => {
    expect(describeEvent({ type: "dependency_done", payload: { number: 1, title: "Banco", all_done: true } }, name)).toMatchObject({ text: "concluiu #1 Banco", tag: { label: "Liberou" } });
    expect(describeEvent({ type: "dependency_done", payload: { number: 1, title: "Banco", all_done: false } }, name).tag).toBeUndefined();
    expect(describeEvent({ type: "task_blocked", payload: { reason: "push 403" } }, name)).toMatchObject({ text: "push 403", tag: { label: "Bloqueado" } });
    expect(describeEvent({ type: "availability_changed", payload: { status: "near_limit", note: "cota acaba em 20 min" } }, name)).toMatchObject({
      text: "cota acaba em 20 min",
      tag: { label: "Perto do limite" },
    });
  });
});

describe("describeEvent: contexto", () => {
  const name = () => "Alguém";
  it("diferencia skill de contexto", () => {
    expect(describeEvent({ type: "context_updated", payload: { action: "create", block_title: "Skill: Revisar PR" } }, name)).toMatchObject({ text: "criou a skill", detail: "Revisar PR" });
    expect(describeEvent({ type: "context_updated", payload: { action: "update", block_title: "Decisões" } }, name)).toMatchObject({ text: "atualizou o contexto", detail: "Decisões" });
  });
});
