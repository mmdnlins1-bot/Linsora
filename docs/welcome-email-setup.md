# Linsora — E-mail de boas-vindas pós-confirmação (setup manual)

> Tudo abaixo é **manual e em produção**. Nada foi executado, configurado
> ou publicado durante a implementação. Nenhum segredo consta no repositório.

## Como funciona

```
signUp → Supabase envia confirmação → usuário clica
→ auth.users.email_confirmed_at = now()
→ TRIGGER on_auth_user_confirmed_welcome (WHEN NULL → NOT NULL)
→ pg_net POST https://<app>/api/send-welcome { user_id, email } + x-welcome-secret
→ endpoint revalida via Auth Admin API → claim atômico em public.welcome_emails
→ Resend (Idempotency-Key linsora-welcome-<user_id>) → status=sent
```

Sem polling. Sem chamada do frontend no login. Sem envio no submit do cadastro.

## Supabase (manual, Dashboard + SQL Editor)

1. **Authentication → Providers → Email**: `Confirm email = ON`.
2. **Authentication → URL Configuration → Redirect URLs**: adicionar
   `https://<app>/?email_confirmed=1` (produção e previews).
3. **Database → Extensions**: confirmar `pg_net` e `supabase_vault` habilitadas.
4. **Database → Vault → New secret** (2 segredos, valores reais só aqui):
   - nome `welcome_hook_secret` → mesmo valor de `WELCOME_HOOK_SECRET` da Vercel;
   - nome `welcome_webhook_url` → ex. `https://<app>.vercel.app/api/send-welcome`.
5. **SQL Editor**: colar `supabase_migration_welcome_email.sql` → RUN.
   A migration é idempotente (pode rodar de novo sem destruir dados) e não
   toca em `subscriptions`, trial, RLS existente, recovery ou Hotmart.

## Vercel (SERVER-ONLY — nunca `VITE_`/`NEXT_PUBLIC_`)

| Variável | Finalidade |
|---|---|
| `LINSORA_SUPABASE_URL` | URL do projeto (Admin API + REST) |
| `SUPABASE_SERVICE_ROLE_KEY` | Revalidar usuário + ler/gravar `welcome_emails` via REST. Só servidor. |
| `WELCOME_HOOK_SECRET` | Autenticar o POST do trigger. Só servidor. |
| `RESEND_API_KEY` | Envio via Resend. Só servidor. |
| `WELCOME_FROM_EMAIL` | Remetente verificado (ex. `Linsora <ola@seudominio.com.br>`) |
| `WELCOME_APP_URL` | (opcional) botão "Abrir o Linsora" no HTML |

Sem `RESEND_API_KEY`/`WELCOME_FROM_EMAIL`, o endpoint responde `503
welcome-provider-unconfigured` e **não finge envio**.

## Resend

- Conta + **domínio verificado** (o remetente precisa pertencer a ele).
- Gerar API key → `RESEND_API_KEY` na Vercel.
- Assunto fixo: `Bem-vindo ao Linsora! Sua conta foi criada`.

## Idempotência (resumo)

1. `WHEN (OLD NULL AND NEW NOT NULL)` — dispara 1x por conta;
2. `UPDATE ... WHERE status IN (pending,failed) AND lease livre` — **uma
   única instrução atômica** decide quem envia (concorrentes perdem);
3. `status=sent`/`sent_at` gravados **só após 200 do Resend**; falha vira
   `failed` + `last_error` com lease liberado (retry seguro);
4. `Idempotency-Key: linsora-welcome-<user_id>` no Resend.
- Não se afirma "exactly once" entre Postgres→rede→Vercel→Resend; o
  desenho é at-least-once no transporte + idempotência no processamento.

## Teste de produção (manual, depois do setup)

1. Criar conta nova com e-mail real de teste.
2. Confirmar pelo link do e-mail.
3. Verificar chegada do welcome (1x) com o nome do cadastro.
4. Verificar `SELECT status, sent_at FROM public.welcome_emails WHERE
   user_id = '<id>';` → `sent` + timestamp.
5. Repetir o POST do webhook (mesmo body + segredo) → `200 {already:true}`,
   sem novo e-mail.
6. Conferir que trial (`trial_started_at/ends_at`) e recovery seguem intactos.
