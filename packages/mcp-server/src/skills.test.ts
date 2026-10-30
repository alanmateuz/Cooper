import { describe, expect, it } from "vitest";
import { skillsFrom, slugify } from "./skills";

describe("skills", () => {
  it("só blocos com Skill: no título, com nome de comando limpo", () => {
    const r = skillsFrom([
      { title: "Arquitetura", preview: "D1" },
      { title: "Skill: Revisão de PR", preview: "checklist" },
      { title: "skill:deploy" },
      { title: "Skill: Revisão de PR (cópia)" },
      { title: "Skill: revisao de pr" },
    ]);
    expect(r.map((x) => x.name)).toEqual(["revisao-de-pr", "deploy", "revisao-de-pr-copia"]);
    expect(r[0]!.title).toBe("Skill: Revisão de PR");
  });
  it("slug sem acento nem símbolos", () => {
    expect(slugify("  Checklist de Lançamento!! ")).toBe("checklist-de-lancamento");
  });
});
