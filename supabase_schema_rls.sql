/*
============================================================================
LINSORA FINANCES - ESQUEMA COMPLETO DE BANCO DE DADOS & POLITICAS RLS
Copie todo este arquivo e cole no SQL Editor do Supabase -> Clique em RUN
============================================================================
*/

-- 1. EXTENSOES & CONFIGURACOES
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. TABELA DE PERFIS DE USUARIO (PROFILES)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT NOT NULL,
  avatar_url TEXT,
  plan TEXT DEFAULT 'PRO',
  is_pin_enabled BOOLEAN DEFAULT FALSE,
  pin_code TEXT DEFAULT '1234',
  is_ai_enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. TABELA DE CONTAS BANCARIAS (ACCOUNTS)
CREATE TABLE IF NOT EXISTS public.accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  bank TEXT,
  type TEXT DEFAULT 'CORRENTE',
  balance NUMERIC(15, 2) DEFAULT 0.00,
  color TEXT DEFAULT '#059669',
  icon TEXT DEFAULT '🏛️',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. TABELA DE CARTOES DE CREDITO (CARDS)
CREATE TABLE IF NOT EXISTS public.cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  brand TEXT DEFAULT 'Mastercard',
  last4 TEXT DEFAULT '0000',
  limit_total NUMERIC(15, 2) DEFAULT 5000.00,
  limit_used NUMERIC(15, 2) DEFAULT 0.00,
  closing_day INT DEFAULT 15,
  due_day INT DEFAULT 22,
  color_class TEXT DEFAULT 'nubank',
  status TEXT DEFAULT 'ABERTA',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. TABELA DE CHAVES PIX (PIX_KEYS)
CREATE TABLE IF NOT EXISTS public.pix_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  key TEXT NOT NULL,
  bank TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. TABELA DE METAS FINANCEIRAS (GOALS)
CREATE TABLE IF NOT EXISTS public.goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  target NUMERIC(15, 2) NOT NULL,
  current NUMERIC(15, 2) DEFAULT 0.00,
  category TEXT DEFAULT 'Economia',
  deadline DATE,
  icon TEXT DEFAULT '🎯',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. TABELA DE CONTAS FIXAS (FIXED_BILLS)
CREATE TABLE IF NOT EXISTS public.fixed_bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  amount NUMERIC(15, 2) NOT NULL,
  due_day INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. TABELA DE TRANSACOES (TRANSACTIONS)
CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('RECEITA', 'DESPESA')),
  amount NUMERIC(15, 2) NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  date DATE NOT NULL,
  account TEXT NOT NULL,
  status TEXT DEFAULT 'CONCLUIDO',
  repetition TEXT DEFAULT 'SINGLE',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

/*
============================================================================
HABILITAR ROW LEVEL SECURITY (RLS) EM TODAS AS TABELAS
============================================================================
*/
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pix_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fixed_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

/*
============================================================================
POLITICAS DE SEGURANCA RLS ESTREITAS (APENAS O PROPRIO USUARIO LE E ESCREVE)
============================================================================
*/

-- POLITICAS: PROFILES
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- POLITICAS: ACCOUNTS
DROP POLICY IF EXISTS "Users can manage own accounts" ON public.accounts;
CREATE POLICY "Users can manage own accounts" ON public.accounts
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- POLITICAS: CARDS
DROP POLICY IF EXISTS "Users can manage own cards" ON public.cards;
CREATE POLICY "Users can manage own cards" ON public.cards
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- POLITICAS: PIX_KEYS
DROP POLICY IF EXISTS "Users can manage own pix_keys" ON public.pix_keys;
CREATE POLICY "Users can manage own pix_keys" ON public.pix_keys
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- POLITICAS: GOALS
DROP POLICY IF EXISTS "Users can manage own goals" ON public.goals;
CREATE POLICY "Users can manage own goals" ON public.goals
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- POLITICAS: FIXED_BILLS
DROP POLICY IF EXISTS "Users can manage own fixed_bills" ON public.fixed_bills;
CREATE POLICY "Users can manage own fixed_bills" ON public.fixed_bills
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- POLITICAS: TRANSACTIONS
DROP POLICY IF EXISTS "Users can manage own transactions" ON public.transactions;
CREATE POLICY "Users can manage own transactions" ON public.transactions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

/*
============================================================================
TRIGGER AUTOMATICO PARA CRIAR PROFILE AO REGISTRAR NOVO USUARIO SUPABASE
============================================================================
*/
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
