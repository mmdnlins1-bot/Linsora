/*
============================================================================
LINSORA - MIGRATION: ENTITLEMENT SERVER-SIDE (bloqueio de escrita pós-expiração)
Copie todo este arquivo e cole no SQL Editor do Supabase -> Clique em RUN
============================================================================

DOCUMENTACAO:
- Problema corrigido (P1 REAL, confirmado por duas auditorias read-only):
  o frontend bloqueia trial expirado/sem assinatura, mas o RLS verificava
  somente `auth.uid() = user_id`; um usuário autenticado e expirado ainda
  conseguia SELECT/INSERT/UPDATE/DELETE nos próprios dados via Supabase
  direto (anon key + JWT válido).
- Regra de produto implementada aqui (somente backend; nenhum frontend, API,
  webhook, trigger ou semântica de trial/assinatura é alterada):
  . trial válido OU assinatura válida -> SELECT/INSERT/UPDATE/DELETE livres;
  . trial expirado E sem assinatura válida -> SELECT livre, INSERT/UPDATE/
    DELETE negados;
  . usuário A em dados de B -> continua negado (auth.uid() preservado).
- Leitura NUNCA é bloqueada por esta migration (decisão de produto: o
  usuário expirado continua vendo os próprios dados e a tela de planos).
- A função `public.has_active_access()` é SECURITY DEFINER e consulta
  `public.subscriptions` diretamente como dona da função (bypassa o RLS):
  policies que a chamam NÃO reentram em policies de `subscriptions`,
  portanto NÃO há recursão RLS (cadeia policy -> função -> tabela, fim).
- A função NÃO recebe `user_id` (usa `auth.uid()` internamente), retorna
  SOMENTE boolean (nenhum dado da assinatura é exposto) e usa `now()` do
  Postgres (nunca relógio do cliente).
- Semântica idêntica à regra validada no app (`canEnterWithSubscription` +
  `get_trial_status`): active sem fim ou com fim futuro; canceled somente
  com fim futuro e não-nulo; trial com `trial_ends_at` futuro. Nenhum
  status é modificado, nenhum trial é criado/reiniciado, Hotmail/Hotmart,
  claim, welcome, recovery e onboarding seguem intactos.
- Escopo exclusivo: função nova + policies de ESCRITA das 7 tabelas de
  dados EXISTENTES no banco (profiles, accounts, cards, pix_keys, goals,
  fixed_bills, transactions). `recurring_bills`,
  `recurring_bill_occurrences` e `welcome_emails` NÃO existem no Supabase
  real e NÃO são referenciadas aqui (nada é criado para elas).
  `subscriptions`, `subscription_events` NÃO são tocadas. `get_trial_status()`,
  `handle_new_trial()`, triggers e webhooks NÃO são tocados.
- Padrão do projeto: DROP POLICY IF EXISTS + CREATE POLICY (reexecutável),
  como nas migrations anteriores. Rode UMA VEZ no SQL Editor, após o schema
  principal e as migrations de subscriptions/trial/recorrências.
============================================================================
*/

-- ---------------------------------------------------------------------------
-- 1. FUNÇÃO DE ENTITLEMENT (booleano; sem parâmetros; sem identificador do cliente)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_active_access()
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.subscriptions AS s
    WHERE s.user_id = auth.uid()
      AND (
        (
          s.status = 'active'
          AND (s.current_period_end IS NULL OR s.current_period_end > now())
        )
        OR (
          s.status = 'canceled'
          AND s.current_period_end IS NOT NULL
          AND s.current_period_end > now()
        )
        OR (
          s.trial_ends_at IS NOT NULL
          AND s.trial_ends_at > now()
        )
      )
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. MENOR PRIVILÉGIO: indisponível para anon/PUBLIC; executável por
--    authenticated (a chamada indireta via policy exige EXECUTE). A função
--    revela apenas um booleano sobre o próprio chamador (auth.uid()).
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.has_active_access() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_active_access() FROM anon;
GRANT EXECUTE ON FUNCTION public.has_active_access() TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. PROFILES: SELECT inalterado; INSERT/UPDATE exigem entitlement.
--    (Sem policy DELETE: exclusão continua negada. A criação inicial por
--    trigger SECURITY DEFINER bypassa o RLS e NÃO é afetada.)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (
    auth.uid() = id AND public.has_active_access()
  );

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (
    auth.uid() = id AND public.has_active_access()
  ) WITH CHECK (
    auth.uid() = id AND public.has_active_access()
  );

-- ---------------------------------------------------------------------------
-- 4. ACCOUNTS: FOR ALL dividido em SELECT livre + escrita com entitlement.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can manage own accounts" ON public.accounts;
DROP POLICY IF EXISTS "Users can view own accounts" ON public.accounts;
CREATE POLICY "Users can view own accounts" ON public.accounts
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own accounts" ON public.accounts;
CREATE POLICY "Users can insert own accounts" ON public.accounts
  FOR INSERT WITH CHECK (
    auth.uid() = user_id AND public.has_active_access()
  );
DROP POLICY IF EXISTS "Users can update own accounts" ON public.accounts;
CREATE POLICY "Users can update own accounts" ON public.accounts
  FOR UPDATE USING (
    auth.uid() = user_id AND public.has_active_access()
  ) WITH CHECK (
    auth.uid() = user_id AND public.has_active_access()
  );
DROP POLICY IF EXISTS "Users can delete own accounts" ON public.accounts;
CREATE POLICY "Users can delete own accounts" ON public.accounts
  FOR DELETE USING (
    auth.uid() = user_id AND public.has_active_access()
  );

-- ---------------------------------------------------------------------------
-- 5. CARDS: mesmo desenho de accounts.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can manage own cards" ON public.cards;
DROP POLICY IF EXISTS "Users can view own cards" ON public.cards;
CREATE POLICY "Users can view own cards" ON public.cards
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own cards" ON public.cards;
CREATE POLICY "Users can insert own cards" ON public.cards
  FOR INSERT WITH CHECK (
    auth.uid() = user_id AND public.has_active_access()
  );
DROP POLICY IF EXISTS "Users can update own cards" ON public.cards;
CREATE POLICY "Users can update own cards" ON public.cards
  FOR UPDATE USING (
    auth.uid() = user_id AND public.has_active_access()
  ) WITH CHECK (
    auth.uid() = user_id AND public.has_active_access()
  );
DROP POLICY IF EXISTS "Users can delete own cards" ON public.cards;
CREATE POLICY "Users can delete own cards" ON public.cards
  FOR DELETE USING (
    auth.uid() = user_id AND public.has_active_access()
  );

-- ---------------------------------------------------------------------------
-- 6. PIX_KEYS: mesmo desenho de accounts.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can manage own pix_keys" ON public.pix_keys;
DROP POLICY IF EXISTS "Users can view own pix_keys" ON public.pix_keys;
CREATE POLICY "Users can view own pix_keys" ON public.pix_keys
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own pix_keys" ON public.pix_keys;
CREATE POLICY "Users can insert own pix_keys" ON public.pix_keys
  FOR INSERT WITH CHECK (
    auth.uid() = user_id AND public.has_active_access()
  );
DROP POLICY IF EXISTS "Users can update own pix_keys" ON public.pix_keys;
CREATE POLICY "Users can update own pix_keys" ON public.pix_keys
  FOR UPDATE USING (
    auth.uid() = user_id AND public.has_active_access()
  ) WITH CHECK (
    auth.uid() = user_id AND public.has_active_access()
  );
DROP POLICY IF EXISTS "Users can delete own pix_keys" ON public.pix_keys;
CREATE POLICY "Users can delete own pix_keys" ON public.pix_keys
  FOR DELETE USING (
    auth.uid() = user_id AND public.has_active_access()
  );

-- ---------------------------------------------------------------------------
-- 7. GOALS: mesmo desenho de accounts.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can manage own goals" ON public.goals;
DROP POLICY IF EXISTS "Users can view own goals" ON public.goals;
CREATE POLICY "Users can view own goals" ON public.goals
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own goals" ON public.goals;
CREATE POLICY "Users can insert own goals" ON public.goals
  FOR INSERT WITH CHECK (
    auth.uid() = user_id AND public.has_active_access()
  );
DROP POLICY IF EXISTS "Users can update own goals" ON public.goals;
CREATE POLICY "Users can update own goals" ON public.goals
  FOR UPDATE USING (
    auth.uid() = user_id AND public.has_active_access()
  ) WITH CHECK (
    auth.uid() = user_id AND public.has_active_access()
  );
DROP POLICY IF EXISTS "Users can delete own goals" ON public.goals;
CREATE POLICY "Users can delete own goals" ON public.goals
  FOR DELETE USING (
    auth.uid() = user_id AND public.has_active_access()
  );

-- ---------------------------------------------------------------------------
-- 8. FIXED_BILLS: mesmo desenho de accounts.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can manage own fixed_bills" ON public.fixed_bills;
DROP POLICY IF EXISTS "Users can view own fixed_bills" ON public.fixed_bills;
CREATE POLICY "Users can view own fixed_bills" ON public.fixed_bills
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own fixed_bills" ON public.fixed_bills;
CREATE POLICY "Users can insert own fixed_bills" ON public.fixed_bills
  FOR INSERT WITH CHECK (
    auth.uid() = user_id AND public.has_active_access()
  );
DROP POLICY IF EXISTS "Users can update own fixed_bills" ON public.fixed_bills;
CREATE POLICY "Users can update own fixed_bills" ON public.fixed_bills
  FOR UPDATE USING (
    auth.uid() = user_id AND public.has_active_access()
  ) WITH CHECK (
    auth.uid() = user_id AND public.has_active_access()
  );
DROP POLICY IF EXISTS "Users can delete own fixed_bills" ON public.fixed_bills;
CREATE POLICY "Users can delete own fixed_bills" ON public.fixed_bills
  FOR DELETE USING (
    auth.uid() = user_id AND public.has_active_access()
  );

-- ---------------------------------------------------------------------------
-- 9. TRANSACTIONS: mesmo desenho de accounts.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can manage own transactions" ON public.transactions;
DROP POLICY IF EXISTS "Users can view own transactions" ON public.transactions;
CREATE POLICY "Users can view own transactions" ON public.transactions
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own transactions" ON public.transactions;
CREATE POLICY "Users can insert own transactions" ON public.transactions
  FOR INSERT WITH CHECK (
    auth.uid() = user_id AND public.has_active_access()
  );
DROP POLICY IF EXISTS "Users can update own transactions" ON public.transactions;
CREATE POLICY "Users can update own transactions" ON public.transactions
  FOR UPDATE USING (
    auth.uid() = user_id AND public.has_active_access()
  ) WITH CHECK (
    auth.uid() = user_id AND public.has_active_access()
  );
DROP POLICY IF EXISTS "Users can delete own transactions" ON public.transactions;
CREATE POLICY "Users can delete own transactions" ON public.transactions
  FOR DELETE USING (
    auth.uid() = user_id AND public.has_active_access()
  );

-- ---------------------------------------------------------------------------
-- FIM. Tabelas e objetos deliberadamente NÃO tocados por esta migration:
-- public.subscriptions, public.subscription_events (policies SELECT próprias
-- preservadas), public.get_trial_status(), public.handle_new_trial(),
-- public.handle_new_user(), webhook Hotmart, claim-subscription, send-welcome,
-- frontend (js/*), vercel.json, recovery, autenticação, confirmação de e-mail.
-- NADA é criado para recurring_bills, recurring_bill_occurrences ou
-- welcome_emails: essas tabelas NÃO existem no banco real.
-- ---------------------------------------------------------------------------
