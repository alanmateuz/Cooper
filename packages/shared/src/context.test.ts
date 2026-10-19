import { describe, expect, it } from "vitest";
import { authorLabel, splitContext } from "./context.js";

describe("splitContext", () => {
  it("divide pelos títulos e põe o texto inicial em Resumo", () => {
    const text = "Plataforma de hackathons.\n\n## Stack\nReact + D1\n\n### Convenções\n- branches claude/<tema>\n";
    expect(splitContext(text)).toEqual([
      { title: "Resumo", content: "Plataforma de hackathons." },
      { title: "Stack", content: "React + D1" },
      { title: "Convenções", content: "- branches claude/<tema>" },
    ]);
  });

  it("texto sem títulos vira um bloco só", () => {
    expect(splitContext("só um parágrafo")).toEqual([{ title: "Resumo", content: "só um parágrafo" }]);
  });

  it("junta títulos repetidos e ignora Resumo vazio", () => {
    expect(splitContext("\n# API\nGET /a\n# api\nPOST /b")).toEqual([{ title: "API", content: "GET /a\n\nPOST /b" }]);
  });
});

describe("authorLabel", () => {
  it("nomeia o agente quando foi um agente", () => {
    expect(authorLabel("Ian", "codex")).toBe("Codex de Ian");
    expect(authorLabel("Bia", null)).toBe("Bia");
  });
});
