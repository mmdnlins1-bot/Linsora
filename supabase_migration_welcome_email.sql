/*
============================================================================
LINSORA - MIGRATION: E-MAIL DE BOAS-VINDAS POS-CONFIRMACAO (welcome)
Copie todo este arquivo e cole no SQL Editor do Supabase -> Clique em RUN
NAO executar automaticamente. Configurar segredos ANTES (ver SECAO 0).
============================================================================

DOCUMENTACAO:
- Objetivo: disparar o e-mail de boas-vindas EXATAMENTE quando o usuario
  confirma o e-mail, sem depender do navegador, sem polling e sem enviar
  no submit do cadastro.
- Evento capturado: transicao
      OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL
  em trigger AFTER UPDATE OF email_confirmed_at ON auth.users.
  Nao dispara para login, last_sign_in_at, metadata, senha ou qualquer
  outro UPDATE (a clausula WHEN filtra na origem).
- Transporte: pg_net (assincrono, nao bloqueia a confirmacao). Falha de
  rede nunca impede o login do usuario (bloco EXCEPTION -> RETURN NEW).
- Destino: POST https://<app>/api/send-welcome com segredo server-to-
  server (WELCOME_HOOK_SECRET). O endpoint revalida o usuario via Auth
  Admin API, aplica claim atomico e envia via Resend com Idempotency-Key
  deterministica (linsora-welcome-<user_id>).
- Controle de idempotencia/concorrencia: tabela public.welcome_emails
  com maquina de estados pending -> sending -> sent | failed (+ lease
  claimed_at de 10 minutos e contador attempts). Ver api/send-welcome.js.
- Escopo exclusivo: confirmacao de e-mail. Esta migration NAO le, NAO
  escreve e NAO altera subscriptions, trial_started_at, trial_ends_at,
  get_trial_status, handle_new_trial, RLS existente, recovery, Hotmart
  ou qualquer logica financeira.
- Idempotente: pode ser rodada mais de uma vez (IF NOT EXISTS, DROP
  TRIGGER IF EXISTS, CREATE OR REPLACE). Nao destroi dados.

SECAO 0 - PRE-REQUISITOS MANUAIS (antes do RUN):
  a) Database -> Extensions: confirmar "pg_net" habilitada.
  b) Database -> Extensions: confirmar "supabase_vault" habilitada.
  c) Criar os segredos no Vault (Dashboard -> Database -> Vault -> New secret,
     ou via SQL com o valor real APENAS no Dashboard, nunca neste arquivo):
       nome "welcome_hook_secret" : mesmo valor de WELCOME_HOOK_SECRET da Vercel
       nome "welcome_webhook_url" : URL completa do endpoint, ex.
                                    https://<app>.vercel.app/api/send-welcome
  d) Vercel -> Settings -> Environment Variables (todas SERVER-ONLY):
       WELCOME_HOOK_SECRET, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY,
       WELCOME_FROM_EMAIL, WELCOME_APP_URL (opcional), LINSORA_SUPABASE_URL.
  NENHUM valor real de segredo consta neste arquivo.
============================================================================
*/

-- ---------------------------------------------------------------------------
-- 1. EXTENSOES (pg_net = transporte async; vault = segredos fora do codigo)
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pg_net";
CREATE EXTENSION IF NOT EXISTS "supabase_vault";

-- ---------------------------------------------------------------------------
-- 2. TABELA DE CONTROLE DO ENVIO (maquina de estados + lease anti-corrida)
-- status: 'pending' -> 'sending' -> 'sent' | 'failed' (failed pode voltar
-- para 'sending' em retry). claimed_at = lease de 10 min: se o worker que
-- adquiriu o claim morrer, outro retry pode reassumir sem duplicar.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.welcome_emails (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts INT NOT NULL DEFAULT 0,
  claimed_at TIMESTAMPTZ NULL,
  sent_at TIMESTAMPTZ NULL,
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS ligada SEM policies de leitura/escrita para anon/authenticated:
-- somente service_role (endpoint) e a funcao SECURITY DEFINER tocam aqui.
ALTER TABLE public.welcome_emails ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.welcome_emails FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. FUNCAO DO TRIGGER: enfileira o POST sem bloquear a confirmacao
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_welcome_email()
RETURNS TRIGGER
SET search_path = public, pg_temp
AS $$
DECLARE
  hook_secret TEXT;
  webhook_url TEXT;
  payload JSONB;
BEGIN
  -- Defesa em profundidade: a clausula WHEN do trigger ja filtra a
  -- transicao, mas a funcao reconfere antes de qualquer efeito externo.
  IF OLD.email_confirmed_at IS NOT NULL OR NEW.email_confirmed_at IS NULL THEN
    RETURN NEW;
  END IF;

  -- Segredos lidos do Vault em runtime (nunca hardcoded aqui).
  SELECT decrypted_secret INTO hook_secret
    FROM vault.decrypted_secrets WHERE name = 'welcome_hook_secret';
  SELECT decrypted_secret INTO webhook_url
    FROM vault.decrypted_secrets WHERE name = 'welcome_webhook_url';

  -- Sem segredos configurados: nao ha para onde enviar. Registra a
  -- pendencia como linha 'pending' (o endpoint/retry futuro a processa)
  -- e NUNCA bloqueia a confirmacao do usuario.
  IF hook_secret IS NULL OR webhook_url IS NULL THEN
    INSERT INTO public.welcome_emails (user_id, status, last_error)
    VALUES (NEW.id, 'pending', 'welcome-misconfigured: vault secrets ausentes')
    ON CONFLICT (user_id) DO NOTHING;
    RETURN NEW;
  END IF;

  -- Garante a linha de controle antes do disparo (idempotente).
  INSERT INTO public.welcome_emails (user_id, status)
  VALUES (NEW.id, 'pending')
  ON CONFLICT (user_id) DO NOTHING;

  payload := jsonb_build_object('user_id', NEW.id, 'email', NEW.email);

  -- POST assincrono via pg_net: apenas ENFILEIRA (nao espera resposta).
  -- Timeout curto; falha de rede aqui nao impede o RETURN NEW abaixo.
  PERFORM net.http_post(
    webhook_url,
    payload,
    '{}'::jsonb,
    jsonb_build_object(
      'Content-Type', 'application/json',
      'x-welcome-secret', hook_secret
    ),
    2000
  );

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- O welcome nunca pode impedir a confirmacao da conta: falha silenciosa
    -- com registro de pendencia para retry futuro.
    BEGIN
      INSERT INTO public.welcome_emails (user_id, status, last_error)
      VALUES (NEW.id, 'pending', 'welcome-trigger-error')
      ON CONFLICT (user_id) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      -- ultimo recurso: nem o registro pode quebrar a confirmacao.
      NULL;
    END;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Execucao restrita: apenas o fluxo interno de auth dispara este trigger.
REVOKE ALL ON FUNCTION public.handle_welcome_email() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_welcome_email() TO supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- 4. TRIGGER: SOMENTE a transicao NULL -> NOT NULL de email_confirmed_at
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS on_auth_user_confirmed_welcome ON auth.users;
CREATE TRIGGER on_auth_user_confirmed_welcome
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW
  WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION public.handle_welcome_email();
