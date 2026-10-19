import type { Workspace } from "@cooper/shared";
import { useState } from "react";
import { supabase } from "../lib/supabase";
import { CRITICAL_USAGE_PCT } from "../lib/notifications";
import type { ShareStatus } from "../lib/usage";
import type { WorkspaceData } from "../lib/useWorkspace";
import { AgentsSection } from "./AgentsSection";
import { ProjectInstructions } from "./ProjectInstructions";


export function SettingsTab({
  workspace,
  workspaces,
  onSelect,
  email,
  theme,
  setTheme,
  dim,
  setDim,
  paused,
  now,
  projects,
  children,
}: {
  workspace: Workspace;
  workspaces: Workspace[];
  onSelect: (w: Workspace) => void;
  email: string;
  theme: "dark" | "light";
  setTheme: (t: "dark" | "light") => void;
  dim: boolean;
  setDim: (v: boolean) => void;
  paused: boolean;
  now: Date;
  /** seção de projetos (convites e criar), no fim, antes de sair */
  projects?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="h-full space-y-3.5 overflow-y-auto p-2.5">
      <SettingsSection title="Geral" rows>
        <Row label="Workspace">
          <select value={workspace.id} onChange={(e) => onSelect(workspaces.find((w) => w.id === e.target.value)!)} className={SELECT}>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </Row>
        <Row label="Conta">
          <span className="min-w-0 truncate text-muted" title={email}>{email}</span>
        </Row>
        <Row label="Tema">
          <Segmented
            value={theme}
            onChange={setTheme}
            options={[
              { value: "dark", label: "Escuro" },
              { value: "light", label: "Claro" },
            ]}
          />
        </Row>
        <Row label="Esmaecer fora do foco" hint="Fica translúcido até o mouse passar por cima.">
          <Toggle checked={dim} onChange={setDim} label="Esmaecer fora do foco" />
        </Row>
        <Row label="Sincronização">
          <span className={`inline-flex items-center gap-1.5 ${paused ? "text-warn" : "text-muted"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${paused ? "bg-warn" : "bg-run"}`} />
            {paused ? "pausada pela bandeja" : "ativa"}
          </span>
        </Row>
      </SettingsSection>
      {children}
      <SettingsSection title="Agentes">
        <AgentsSection workspaceId={workspace.id} now={now} />
        <ProjectInstructions />
      </SettingsSection>
      {projects}
      <button
        type="button"
        onClick={() => void supabase.auth.signOut()}
        className="w-full rounded-lg border border-line py-1.5 text-muted transition-colors hover:border-danger/50 hover:bg-danger/10 hover:text-danger"
      >
        Sair da conta
      </button>
    </div>
  );
}

/** Um grupo de Ajustes: título pequeno em cima e um cartão. `rows`: itens separados por linhas finas. */
export function SettingsSection({ title, rows, children }: { title: string; rows?: boolean; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-1 px-1 text-[10.5px] font-semibold tracking-wide text-muted uppercase">{title}</h2>
      <div className={`rounded-xl border border-line bg-panel ${rows ? "divide-y divide-line/70 px-2.5" : "space-y-3 p-2.5"}`}>{children}</div>
    </section>
  );
}

/** ⚙ → Notificações: som e aviso de uso crítico, com botões para ouvir cada alerta. */
export function NotificationSettings({
  sound,
  setSound,
  usageAlerts,
  setUsageAlerts,
  onTest,
  onTestCritical,
}: {
  sound: boolean;
  setSound: (v: boolean) => void;
  usageAlerts: boolean;
  setUsageAlerts: (v: boolean) => void;
  onTest: () => void;
  onTestCritical: () => void;
}) {
  return (
    <div className="space-y-2.5">
      <SwitchRow
        label="Alerta sonoro"
        hint="Toca quando chega uma tarefa e quando alguém aceita, recusa ou conclui uma tarefa."
        checked={sound}
        onChange={setSound}
        test={onTest}
      />
      <SwitchRow
        label={`Uso crítico de IA do time (${CRITICAL_USAGE_PCT}%)`}
        hint={`Avisa, com um som próprio, quando alguém passa de ${CRITICAL_USAGE_PCT}% do limite de 5 h ou da semana. Só vale para quem compartilha o uso.`}
        checked={usageAlerts}
        onChange={setUsageAlerts}
        test={sound ? onTestCritical : undefined}
      />
    </div>
  );
}

function SwitchRow({ label, hint, checked, onChange, test }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void; test?: () => void }) {
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="font-medium">{label}</div>
        <p className="text-[10.5px] leading-snug text-muted">{hint}</p>
        {test && (
          <button type="button" onClick={test} className="mt-0.5 text-[10.5px] text-accent hover:underline">
            Ouvir
          </button>
        )}
      </div>
      <Toggle checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

const SELECT = "max-w-[60%] rounded-md border border-line bg-raised px-1.5 py-1 outline-none focus:border-accent";

/** Interruptor (liga/desliga). */
export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-[18px] w-8 shrink-0 rounded-full transition-colors disabled:opacity-50 ${checked ? "bg-accent" : "bg-line"}`}
    >
      <span className={`absolute top-[2px] left-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-[14px]" : ""}`} />
    </button>
  );
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="flex rounded-md bg-raised p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded px-2 py-0.5 text-[11px] ${value === o.value ? "bg-panel font-semibold shadow-sm" : "text-muted hover:text-text"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** ⚙ → Privacidade. Compartilhar uso é opcional e começa desligado; desligar apaga o que já foi enviado. */
export function PrivacySection({ workspaceId, sharing, status }: { workspaceId: string; sharing: boolean; status: ShareStatus }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function toggle(on: boolean) {
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("set_usage_sharing", { p_workspace: workspaceId, p_on: on });
    setBusy(false);
    if (error) setErr(error.message);
  }
  return (
    <section className="space-y-1">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium">Compartilhar meu uso com o time</div>
          <p className="text-[10.5px] leading-snug text-muted">
            Só números do dia: tokens, modelo e percentual de limite. Prompts, respostas e código nunca saem da sua máquina. Desligar apaga o que
            já foi enviado.
          </p>
        </div>
        <Toggle checked={sharing} disabled={busy} onChange={(v) => void toggle(v)} label="Compartilhar meu uso de IA com o time" />
      </div>
      {err && <p className="text-[10.5px] text-danger">{err}</p>}
      {sharing && (
        <p className={`text-[10.5px] leading-snug ${status?.error ? "text-danger" : "text-muted"}`}>
          {!status
            ? "Aguardando a primeira leitura de uso desta máquina."
            : status.error
              ? `Falha ao enviar às ${hhmm(status.at)}: ${status.error}. Tentando de novo a cada minuto.`
              : `Último envio às ${hhmm(status.at)}.`}
        </p>
      )}
    </section>
  );
}

const hhmm = (d: Date) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <div>{label}</div>
        {hint && <p className="text-[10.5px] leading-snug text-muted">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center p-6 text-center text-muted">{children}</div>;
}
