/*
============================================================================
LINSORA - MIGRATION: ASSINATURAS HOTMART (subscriptions + subscription_events)
Copie todo este arquivo e cole no SQL Editor do Supabase -> Clique em RUN
============================================================================

DOCUMENTACAO:
- Estas tabelas representam a assinatura COMERCIAL do Linsora (mensal/anual
  vendidos na Hotmart). Decisao de produto: Linsora pago desde o inicio;
  a conta e criada no Linsora ANTES da compra, com o MESMO e-mail da Hotmart.
- A ESCRITA sera feita exclusivamente pelo backend do webhook Hotmart
  usando service_role (bypassa o RLS). O aplicativo (anon key) NUNCA escreve
  aqui: o usuario autenticado tem apenas SELECT na propria assinatura e,
  em subscription_events, apenas nos proprios eventos.
- subscription_events existe para AUDITORIA e IDEMPOTENCIA: cada evento do
  Webhook Hotmart V2 e registrado uma unica vez.
- hotmart_event_id e UNIQUE e deve impedir processamento duplicado do mesmo
  evento (o backend faz upsert/insert tolerante a conflito por essa coluna).
- profiles.plan NAO e mecanismo de acesso e NAO e alterado por esta migration;
  o controle real de acesso sera baseado futuramente na tabela subscriptions.
- Esta migration NAO altera nenhuma tabela, policy, trigger ou funcao
  existente. Apenas CRIA objetos novos com prefixo hotmart/subscription.
============================================================================
*/

-- ---------------------------------------------------------------------------
-- 1. TABELA DE ASSINATURAS (uma linha por usuario: user_id UNIQUE)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  email TEXT NOT NULL,
  plan TEXT NOT NULL
    CHECK (plan IN ('mensal', 'anual')),
  status TEXT NOT NULL
    CHECK (status IN (
      'active',
      'pending',
      'past_due',
      'canceled',
      'expired',
      'refunded',
      'chargeback'
    )),
  hotmart_buyer_ucode TEXT,
  hotmart_subscriber_code TEXT,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 2. TABELA DE EVENTOS DO WEBHOOK (auditoria + idempotencia)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscription_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotmart_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  subscription_id UUID REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  plan TEXT,
  status_after TEXT,
  raw JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 3. ROW LEVEL SECURITY
-- Com RLS habilitado e SEM policy de escrita, INSERT/UPDATE/DELETE sao
-- negados ao usuario comum por padrao. Apenas as policies SELECT abaixo
-- existem; a escrita futura usa service_role (bypassa o RLS).
-- ---------------------------------------------------------------------------
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_events ENABLE ROW LEVEL SECURITY;

-- subscriptions: usuario autenticado le SOMENTE a propria assinatura.
DROP POLICY IF EXISTS "Users can view own subscription" ON public.subscriptions;
CREATE POLICY "Users can view own subscription" ON public.subscriptions
  FOR SELECT USING (auth.uid() = user_id);

-- subscription_events: usuario autenticado le SOMENTE eventos do proprio user_id.
DROP POLICY IF EXISTS "Users can view own subscription events" ON public.subscription_events;
CREATE POLICY "Users can view own subscription events" ON public.subscription_events
  FOR SELECT USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 4. INDICES (somente os necessarios; hotmart_event_id ja tem indice via UNIQUE)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id
  ON public.subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_hotmart_buyer_ucode
  ON public.subscriptions (hotmart_buyer_ucode);
CREATE INDEX IF NOT EXISTS idx_subscriptions_hotmart_subscriber_code
  ON public.subscriptions (hotmart_subscriber_code);
CREATE INDEX IF NOT EXISTS idx_subscription_events_user_id
  ON public.subscription_events (user_id);

-- ---------------------------------------------------------------------------
-- 5. updated_at AUTOMATICO (isolado: funcao/trigger novas, sem tocar nas
--    existentes; o projeto nao possui padrao de trigger para updated_at)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_hotmart_subscription_updated_at()
RETURNS TRIGGER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER trg_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.handle_hotmart_subscription_updated_at();
