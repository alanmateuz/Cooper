import { describe, expect, it } from "vitest";
import { accessFrom, combineChecks, combineReviews, toRow } from "./github";

describe("combineChecks", () => {
  const done = (conclusion: string) => ({ status: "completed", conclusion });
  it("falha vence, depois rodando, depois sucesso", () => {
    expect(combineChecks([done("success"), done("failure")], null)).toBe("failure");
    expect(combineChecks([done("success"), { status: "in_progress", conclusion: null }], null)).toBe("pending");
    expect(combineChecks([done("success"), done("skipped")], null)).toBe("success");
    expect(combineChecks([], { state: "error", total_count: 1 })).toBe("failure");
  });
  it("sem CI nenhum: none (status com total 0 não conta)", () => {
    expect(combineChecks([], { state: "pending", total_count: 0 })).toBe("none");
  });
});

describe("combineReviews", () => {
  const r = (login: string, state: string) => ({ user: { login }, state });
  it("última revisão de cada pessoa; mudança pedida vence", () => {
    expect(combineReviews([r("ian", "CHANGES_REQUESTED"), r("ian", "APPROVED")], 0)).toBe("approved");
    expect(combineReviews([r("ian", "APPROVED"), r("bia", "CHANGES_REQUESTED")], 0)).toBe("changes_requested");
    expect(combineReviews([r("ian", "COMMENTED")], 1)).toBe("pending");
    expect(combineReviews([], 0)).toBeNull();
  });
});

describe("toRow e accessFrom", () => {
  it("PR com merge vira merged; sha inválido vira null", () => {
    const row = toRow(
      { number: 1, title: "Integração", state: "closed", merged_at: "2026-10-30T12:00:00Z", head: { ref: "integracao", sha: "x" }, base: { ref: "main" },
        user: { login: "alanmateuz" }, html_url: "https://github.com/a/b/pull/1", updated_at: "2026-10-30T12:00:00Z" },
      "none",
      null,
    );
    expect(row).toMatchObject({ state: "merged", head_branch: "integracao", head_sha: null, author: "alanmateuz" });
  });
  it("acesso pelas permissões do repositório", () => {
    expect(accessFrom({ permissions: { push: true, pull: true } })).toBe("write");
    expect(accessFrom({ permissions: { push: false, pull: true } })).toBe("read");
    expect(accessFrom({})).toBeNull();
  });
});
