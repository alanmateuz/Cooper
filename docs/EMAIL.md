# E-mail no Cooper: por que não chegava e como resolver

## O que acontece hoje

| E-mail | Quem envia | Problema |
|---|---|---|
| Confirmação de conta e código de senha | Supabase Auth | O servidor de e-mail padrão do Supabase é só para testes: manda pouquíssimos e-mails por hora e pode entregar só para endereços da própria equipe do projeto. Por isso a confirmação não chega para outras pessoas. |
| Convite para o projeto | **Ninguém** | O Cooper nunca enviou e-mail de convite. Agora, depois de convidar, o app oferece **"Copiar mensagem de convite"**: um texto pronto (passos + código de conexão) para mandar no WhatsApp ou e-mail. |

## Resolver a confirmação de conta (uns 15 minutos)

Você precisa de um serviço de envio. O mais simples é o **Resend** (tem plano grátis).

1. Crie uma conta em resend.com.
2. **Domínio:** para mandar para qualquer pessoa, o Resend exige um domínio seu verificado (ele mostra os registros DNS para copiar). Sem domínio, ele só envia para o seu próprio e-mail, o que não resolve o problema.
   - Sem domínio? Alternativa: Gmail com **senha de app** (Conta Google → Segurança → Verificação em duas etapas → Senhas de app). Funciona, com limite diário do Gmail.
3. No Supabase (projeto `iknrfsdcmwluhvesfdqv`): **Authentication → Emails → SMTP Settings** → ligar **Enable custom SMTP**:
   - Resend: host `smtp.resend.com`, porta `465`, usuário `resend`, senha = sua API key do Resend.
   - Gmail: host `smtp.gmail.com`, porta `465`, usuário = seu Gmail, senha = a senha de app.
   - Remetente: um endereço do seu domínio (Resend) ou o seu Gmail.
4. **Authentication → Rate Limits**: aumente "emails por hora" (com SMTP próprio o limite pode subir).
5. Teste criando uma conta com outro e-mail no Cooper.

> Os nomes das telas do Supabase mudam às vezes; se não achar, procure "SMTP" na busca do painel.

### O link de confirmação abre uma página com erro

É esperado: o link volta para a "Site URL" do projeto, que por padrão é `localhost:3000`, onde não há nada rodando. **A conta fica confirmada mesmo assim** (o app já avisa isso). Para ficar mais bonito, em **Authentication → URL Configuration → Site URL**, coloque um endereço seu (por exemplo, a página do repositório no GitHub).

## Convite por e-mail de verdade (opcional, depois)

Dá para o Cooper mandar o convite sozinho: uma Edge Function do Supabase, disparada quando um convite é criado, envia pelo Resend com a mensagem que hoje é copiada. Precisa do domínio verificado no Resend e de guardar a API key como segredo da função. Quando você quiser, eu escrevo a função e o passo a passo para publicar.
