// Mensagens de erro em português para quem usa o widget. Os erros vêm do Supabase (Auth, PostgREST)
// ou do Postgres; as mensagens que o próprio Cooper levanta nas funções do banco já estão em português.

interface ErrLike {
  message?: string;
  code?: string;
  status?: number;
  name?: string;
}

const PT = /[ãõçáéíóúâêô]/i;

export function friendlyError(err: unknown): string {
  if (!err) return "Algo deu errado.";
  const e: ErrLike = typeof err === "string" ? { message: err } : (err as ErrLike);
  const msg = e.message ?? String(err);
  const low = msg.toLowerCase();

  if (low.includes("failed to fetch") || low.includes("networkerror") || low.includes("load failed") || e.name === "AuthRetryableFetchError")
    return "Sem conexão com o servidor. Confira a internet e tente de novo.";
  if (low.includes("invalid login credentials")) return "E-mail ou senha incorretos.";
  if (low.includes("email not confirmed")) return "Confirme o e-mail pelo link que chegou na sua caixa de entrada.";
  if (low.includes("user already registered")) return "Já existe uma conta com esse e-mail. Entre ou use \"Esqueci a senha\".";
  if (low.includes("password should be at least")) return "A senha precisa ter pelo menos 8 caracteres.";
  if (low.includes("token has expired") || low.includes("otp_expired") || (low.includes("invalid") && low.includes("otp")))
    return "Código inválido ou expirado. Peça um novo.";
  if (low.includes("rate limit") || e.status === 429 || e.code === "54000") return "Muitas tentativas seguidas. Espere um pouco e tente de novo.";
  if (low.includes("jwt expired")) return "Sua sessão expirou. Entre de novo.";
  if (e.code === "23505") return "Já existe um item com esse nome.";
  if (e.code === "42501" || low.includes("row-level security") || low.includes("permission denied"))
    return PT.test(msg) && !low.includes("row-level") ? msg : "Você não tem permissão para fazer isso.";
  if (e.code === "PGRST116") return "Não encontrado (pode ter sido apagado).";
  if (e.code === "PGRST202") return "O servidor está desatualizado: rode o SQL de instalação mais recente.";
  // mensagens do próprio Cooper (raise exception nas funções) já vêm em português
  if (PT.test(msg)) return msg;
  return `Erro: ${msg}`;
}
