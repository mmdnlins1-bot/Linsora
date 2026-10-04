/*
============================================================================
LINSORA - MIGRATION: TESTE GRATIS DE 24 HORAS (trial)
Copie todo este arquivo e cole no SQL Editor do Supabase -> Clique em RUN
============================================================================

DOCUMENTACAO:
- Toda conta NOVA recebe automaticamente 24h de acesso gratuito, contadas
  a partir da criacao do usuario em auth.users (horario do servidor).
- Fonte de verdade do trial: colunas trial_started_at/trial_ends_at em
  public.subscriptions (server-side/persistente). NUNCA localStorage,
  cookie ou relogio do navegador.
- O trial nasce por trigger SECURITY DEFINER em auth.users (o cliente anon
  continua sem INSERT/UPDATE/DELETE em subscriptions: nenhuma policy de
  escrita e criada aqui; a policy SELECT existente passa a expor tambem
  as colunas do trial para leitura do proprio usuario).
- Contas existentes antes desta migration permanecem com trial_* = NULL
  (SEM backfill, SEM trial retroativo) e seguem as regras atuais.
- A linha do trial usa status 'pending' + plan 'mensal' como placeholder
  comercial: 'pending' NUNCA libera acesso pela regra paga
  (canEnterWithSubscription exige 'active' ou 'canceled' com vigencia), e
  o webhook Hotmart (upsert por user_id com merge) sobrescreve status/plan
  na compra sem tocar em trial_started_at/trial_ends_at.
- A validade do trial e decidida com now() do Postgres via RPC
  public.get_trial_status() (STABLE + SECURITY DEFINER). O gate chama o RPC
  somente quando a assinatura paga nao concede acesso.
- Esta migration NAO altera colunas, statuses, policies, triggers ou
  funcoes existentes. Apenas ADICIONA colunas, UMA funcao de trigger, UM
  trigger e UMA funcao RPC, todos com prefixo de trial.
============================================================================
*/

-- ---------------------------------------------------------------------------
-- 1. COLUNAS DO TRIAL (NULL por padrao: contas antigas ficam sem trial)
-- ---------------------------------------------------------------------------
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ NULL;

-- ---------------------------------------------------------------------------
-- 2. FUNCAO DO TRIGGER: cria a linha do trial no momento da conta
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_trial()
RETURNS TRIGGER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.subscriptions (
    user_id, email, plan, status, trial_started_at, trial_ends_at
  )
  VALUES (
    NEW.id,
    lower(NEW.email),
    'mensal',
    'pending',
    now(),
    now() + interval '24 hours'
  )
  -- Se a linha ja existir (ex.: criada pelo webhook entre a trigger de
  -- profiles e esta), preenche o trial SOMENTE quando ainda ausente e NAO
  -- toca em nenhuma coluna comercial (plan/status/vigencia/codigos).
  -- Oportunidade unica: trial existente nunca e reiniciado.
  ON CONFLICT (user_id) DO UPDATE SET
    trial_started_at = COALESCE(public.subscriptions.trial_started_at, EXCLUDED.trial_started_at),
    trial_ends_at = COALESCE(public.subscriptions.trial_ends_at, EXCLUDED.trial_ends_at);
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- O trial nunca pode impedir a criacao da conta: falha silenciosa.
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created_trial ON auth.users;
CREATE TRIGGER on_auth_user_created_trial
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_trial();

-- ---------------------------------------------------------------------------
-- 3. RPC: validade do trial decidida com now() do Postgres
-- O cliente autenticado consulta SOMENTE o proprio trial (auth.uid()).
-- Retorna [] quando nao ha linha; o gate trata como "sem trial".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_trial_status()
RETURNS TABLE (trial_valid BOOLEAN, trial_ends_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT
    (s.trial_ends_at IS NOT NULL AND s.trial_ends_at > now()),
    s.trial_ends_at
  FROM public.subscriptions AS s
  WHERE s.user_id = auth.uid()
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_trial_status() TO authenticated;
