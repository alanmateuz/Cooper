import { isSkillTitle } from "@cooper/shared";
import { useState } from "react";
import type { WorkspaceData } from "../lib/useWorkspace";
import { BlockCard } from "./context/BlockCard";
import { ContextSize } from "./context/ContextSize";
import { NewBlock, NewSkill, PasteContext } from "./context/NewBlock";
import { RecentChanges } from "./context/RecentChanges";
import { Icon, type IconName } from "./ui";

/**
 * Aba Contexto, em duas seções que respondem coisas diferentes:
 * - Contexto do projeto: o que a IA consulta para entender o projeto (decisões, contratos, regras).
 * - Skills do time: passo a passo que a IA executa quando alguém usa o comando.
 * Por baixo, as duas são blocos; a skill é o bloco com título "Skill: …".
 */
export function ContextTab({ data, me, now }: { data: WorkspaceData; me: string; now: Date }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState<"new" | "skill" | "paste" | null>(null);
  const blocks = data.context.filter((b) => !b.deleted_at);
  const context = blocks.filter((b) => !isSkillTitle(b.title));
  const skills = blocks.filter((b) => isSkillTitle(b.title));
  const workspaceId = data.workspace?.id ?? "";
  const toggle = (what: "new" | "skill" | "paste") => setAdding(adding === what ? null : what);
  const card = (b: (typeof blocks)[number]) => (
    <BlockCard key={b.id} block={b} data={data} now={now} open={open[b.id] ?? false} setOpen={(v) => setOpen((o) => ({ ...o, [b.id]: v }))} />
  );

  return (
    <div className="h-full space-y-3 overflow-y-auto p-2.5">
      <RecentChanges data={data} me={me} now={now} onShow={(id) => setOpen((o) => ({ ...o, [id]: true }))} />

      <Section
        icon="book"
        title="Contexto do projeto"
        count={context.length}
        hint="O que a IA consulta para entender o projeto: decisões, contratos, regras. Ela lê só os blocos de que precisa."
        actions={
          <>
            <AddButton on={adding === "new"} onClick={() => toggle("new")} label="Bloco" />
            <AddButton on={adding === "paste"} onClick={() => toggle("paste")} label="Colar texto" icon="list" />
          </>
        }
      >
        {adding === "new" && <NewBlock workspaceId={workspaceId} onDone={() => setAdding(null)} />}
        {adding === "paste" && <PasteContext data={data} onDone={() => setAdding(null)} />}
        <ContextSize data={data} />
        {context.length === 0 && adding !== "new" && adding !== "paste" && (
          <p className="px-1 py-2 leading-snug text-muted">Nenhum bloco ainda. Cole um texto (cada título # vira um bloco) ou crie um.</p>
        )}
        {context.map(card)}
      </Section>

      <Section
        icon="terminal"
        title="Skills do time"
        count={skills.length}
        hint="Passo a passo que a IA executa quando alguém usa o comando (no Claude Code, em conversa nova). Ex.: revisar um PR, publicar."
        actions={<AddButton on={adding === "skill"} onClick={() => toggle("skill")} label="Skill" />}
      >
        {adding === "skill" && <NewSkill workspaceId={workspaceId} onDone={() => setAdding(null)} />}
        {skills.length === 0 && adding !== "skill" && (
          <p className="px-1 py-2 leading-snug text-muted">Nenhuma skill ainda. Escreva um passo a passo uma vez e a IA de todo o time ganha o comando.</p>
        )}
        {skills.map(card)}
      </Section>
    </div>
  );
}

function Section({
  icon,
  title,
  count,
  hint,
  actions,
  children,
}: {
  icon: IconName;
  title: string;
  count: number;
  hint: string;
  actions: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-1.5">
      <header className="flex items-center gap-1.5 px-1">
        <Icon name={icon} size={12} />
        <h2 className="font-semibold" title={hint}>{title}</h2>
        <span className="text-[10.5px] text-muted tabular-nums">{count}</span>
        <span className="ml-auto flex gap-1">{actions}</span>
      </header>
      {children}
    </section>
  );
}

function AddButton({ on, onClick, label, icon = "plus" }: { on: boolean; onClick: () => void; label: string; icon?: IconName }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] transition-colors ${on ? "bg-accent text-white" : "border border-line bg-panel hover:bg-raised"}`}
    >
      <Icon name={icon} size={10} /> {label}
    </button>
  );
}
