# Criar o servidor do Cooper (Supabase)

Cada time usa o próprio projeto Supabase. O plano grátis basta. Quem começa o time cria o servidor uma vez;
as outras pessoas só colam o **código de conexão**.

## 1. Criar o projeto

1. Em [supabase.com](https://supabase.com), clique em **New project**.
2. Escolha uma região perto do time e guarde a **senha do banco** num gerenciador de senhas.
   O app não precisa dela; ela só serve para manutenção.

## 2. Autenticação

1. **Authentication → Sign In / Providers → Email**: deixe **Confirm email ligado**.
   O convite para um projeto confia no e-mail da conta. Sem confirmação, alguém poderia se cadastrar com o
   e-mail de outra pessoa e aceitar o convite dela.
2. **Authentication → Emails → Reset Password**: inclua `{{ .Token }}` no texto do e-mail. É o código de 6 dígitos que
   o app pede em "Esqueci a senha". Exemplo:

   ```
   <p>Seu código para trocar a senha do Cooper: <strong>{{ .Token }}</strong></p>
   ```

3. (Opcional) **Authentication → URL Configuration → Site URL**: o link de confirmação de cadastro abre essa página.
   Se ela não existir, o navegador mostra erro, mas a conta fica confirmada mesmo assim.

## 3. Instalar o Cooper no banco

1. Abra **SQL Editor → New query**.
2. Cole o conteúdo de [`supabase/install.sql`](../supabase/install.sql). No app, a tela de Setup tem o botão
   **Copiar SQL de instalação**.
3. Clique em **Run**. Deve terminar sem erros.

O `install.sql` junta todas as migrações em ordem, numa transação só. Ele é gerado por
`pnpm db:install-sql` e conferido no CI.

## 4. Conectar o app

1. **Project Settings → API**: copie a **Project URL** (`https://xxxx.supabase.co`) e a chave **anon public**
   (começa com `eyJ` ou `sb_publishable_`). **Nunca use a `service_role`.**
2. No Cooper, escolha **Criar meu servidor**, cole os dois valores e clique em **Conectar**. O app confere se o SQL
   foi aplicado (função `cooper_server_info()`).
3. Crie sua conta, crie o projeto e convide o time em ⚙ **Ajustes → Equipe**.

## 5. Convidar alguém

1. ⚙ **Ajustes → Equipe → Convidar**, com o e-mail da pessoa.
2. Clique em **Copiar código de conexão** e mande o código junto com o instalador.
3. A pessoa abre o Cooper, escolhe **Tenho um código de conexão**, cria a conta **com o mesmo e-mail** e aceita o convite.

O código de conexão só tem a URL e a chave anon (públicas). Sozinho, não dá acesso a nada: precisa de conta e de convite.

## Atualizar para uma versão nova

Versões novas do app podem pedir um esquema mais novo. Se o Setup avisar que o servidor está desatualizado, rode no
SQL Editor só as migrações novas de [`supabase/migrations`](../supabase/migrations) (as que ainda não foram aplicadas, em
ordem), ou use `pnpm db:push` com `SUPABASE_DB_URL` no `.env`.

## Supabase local (desenvolvimento)

Com o Supabase CLI e Docker, `supabase start` sobe tudo em `http://127.0.0.1:54321`. Esse endereço é aceito pelo app.
