import { describe, expect, it } from "vitest";
import { commitsIn, commitWarnings, type Git } from "./evidence";

describe("commitsIn", () => {
  it("pega hashes das evidências, sem repetir e sem palavras hexadecimais", () => {
    expect(commitsIn(["commit 7078b6d em origin/integracao", "merge ebf5d5d", "7078B6D de novo", "decade", "pnpm test: 42 passaram"])).toEqual([
      "7078b6d",
      "ebf5d5d",
    ]);
  });
});

describe("commitWarnings", () => {
  // repositório fingido: abc1234 está no remoto, def5678 só local
  const fake: Git = async (args) => {
    if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") return "true";
    if (args[0] === "rev-parse") return ["abc1234^{commit}", "def5678^{commit}"].includes(args[3]!) ? "sha" : null;
    if (args[0] === "branch") return args[3] === "abc1234" ? "origin/main" : "";
    return null;
  };

  it("avisa de commit sem push e de commit que não existe", async () => {
    expect(await commitWarnings(["commit abc1234", "commit def5678", "commit 9999999"], fake)).toEqual([
      "o commit def5678 ainda não foi enviado ao remoto: faça push para o time ver",
      "o commit 9999999 não existe nesta cópia do repositório",
    ]);
  });

  it("fora de um repositório git, não avisa nada", async () => {
    expect(await commitWarnings(["commit abc1234"], async () => null)).toEqual([]);
  });
});
