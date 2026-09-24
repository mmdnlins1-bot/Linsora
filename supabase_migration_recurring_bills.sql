/*
============================================================================
LINSORA FINANCES - MIGRATION: CONTAS RECORRENTES E OCORRÊNCIAS (ETAPA 1)
Isolada e conservadora: não altera nenhuma tabela existente (inclusive
fixed_bills, cards, transactions e goals). Rode este arquivo UMA VEZ no
SQL Editor do Supabase, após o schema principal (supabase_schema_rls.sql).
============================================================================
*/

-- --------------------------------------------------------------------------
-- 1. REGRA RECORRENTE (configuração permanente da conta)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recurring_bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  category TEXT NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'MONTHLY',
  due_day INTEGER NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT recurring_bills_amount_positive CHECK (amount > 0),
  CONSTRAINT recurring_bills_due_day_valid CHECK (due_day >= 1 AND due_day <= 31),
  CONSTRAINT recurring_bills_frequency_v1 CHECK (frequency = 'MONTHLY'),
  CONSTRAINT recurring_bills_end_after_start CHECK (end_date IS NULL OR end_date >= start_date)
);

-- --------------------------------------------------------------------------
-- 2. OCORRÊNCIA (obrigação concreta em um período; nunca é a transação)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recurring_bill_occurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recurring_bill_id UUID NOT NULL REFERENCES public.recurring_bills(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  due_date DATE NOT NULL,
  expected_amount NUMERIC NOT NULL,
  paid_amount NUMERIC NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  paid_at TIMESTAMPTZ NULL,
  transaction_id UUID NULL REFERENCES public.transactions(id) ON DELETE SET NULL,
  skipped_reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT recurring_bill_occurrences_status_valid
    CHECK (status IN ('PENDING', 'PAID', 'SKIPPED')),
  CONSTRAINT recurring_bill_occurrences_expected_non_negative
    CHECK (expected_amount >= 0),
  -- Idempotência: uma conta tem no máximo uma ocorrência por vencimento e usuário
  CONSTRAINT recurring_bill_occurrences_unique_per_due
    UNIQUE (user_id, recurring_bill_id, due_date)
);

-- Índices mínimos: janelas de vencimento e ocorrências da regra
CREATE INDEX IF NOT EXISTS idx_occurrences_user_due_status
  ON public.recurring_bill_occurrences (user_id, due_date, status);
CREATE INDEX IF NOT EXISTS idx_occurrences_user_bill
  ON public.recurring_bill_occurrences (user_id, recurring_bill_id);

-- --------------------------------------------------------------------------
-- 3. RLS (mesmo padrão multi-tenant do projeto: auth.uid() = user_id)
-- --------------------------------------------------------------------------
ALTER TABLE public.recurring_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_bill_occurrences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own recurring bills" ON public.recurring_bills;
CREATE POLICY "Users can manage own recurring bills" ON public.recurring_bills
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage own occurrences" ON public.recurring_bill_occurrences;
CREATE POLICY "Users can manage own occurrences" ON public.recurring_bill_occurrences
  -- Leitura/escrita/exclusão restritas ao próprio usuário; além disso, um
  -- transaction_id vinculado precisa pertencer a uma transação do mesmo usuário,
  -- impedindo associação cross-tenant entre ocorrência e transação alheia.
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (
    auth.uid() = user_id AND (
      transaction_id IS NULL OR EXISTS (
        SELECT 1 FROM public.transactions t
        WHERE t.id = transaction_id AND t.user_id = auth.uid()
      )
    )
  );
