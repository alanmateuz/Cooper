import { describe, expect, it } from "vitest";
import { friendlyError } from "./errors";

describe("friendlyError", () => {
  it("traduz erros comuns do Supabase e do Postgres", () => {
    expect(friendlyError({ message: "Invalid login credentials" })).toBe("E-mail ou senha incorretos.");
    expect(friendlyError({ message: "TypeError: Failed to fetch" })).toMatch(/Sem conexão/);
    expect(friendlyError({ code: "23505", message: "duplicate key value violates unique constraint" })).toMatch(/Já existe/);
    expect(friendlyError({ code: "42501", message: "new row violates row-level security policy" })).toMatch(/permissão/);
    expect(friendlyError({ message: "Token has expired or is invalid" })).toMatch(/Código inválido/);
  });

  it("mantém mensagens do Cooper, que já vêm em português", () => {
    const m = "só quem criou a tarefa (ou o dono do projeto) edita título, prompt, descrição e critérios";
    expect(friendlyError({ code: "42501", message: m })).toBe(m);
  });

  it("nunca devolve vazio", () => {
    expect(friendlyError(null)).toBeTruthy();
    expect(friendlyError({ message: "boom" })).toBe("Erro: boom");
  });
});
