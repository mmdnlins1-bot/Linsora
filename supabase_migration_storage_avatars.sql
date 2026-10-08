/*
============================================================================
LINSORA - MIGRATION: SUPABASE STORAGE DO AVATAR (bucket avatars)
Copie todo este arquivo e cole no SQL Editor do Supabase -> Clique em RUN
NÃO executar automaticamente. Revisar antes em ambiente de desenvolvimento.
============================================================================

DOCUMENTACAO:
- Objetivo: configurar o bucket `avatars` com o mínimo necessário para o
  fluxo atual de foto de perfil, sem conceder permissões que o app não usa.
- O frontend envia SOMENTE JPEG re-encodado pelo canvas
  (400x400, quality 0.7, magic bytes FF D8 FF verificados no client) via:
    supabase.storage.from('avatars').upload(
      'avatar_<userId>_<timestamp>.jpg',
      blob,
      { upsert: true, contentType: 'image/jpeg' }
    )
  e lê via getPublicUrl(fileName) + <img src>. Não há .remove/.download/
  .list/.copy/.move nem createSignedUrl no código do app.
- Bucket PÚBLICO é intencional: <img src> não envia cabeçalhos de
  autorização, então a leitura precisa sair pela camada pública de objetos
  (getPublicUrl). Leitura pública do objeto NÃO equivale a listagem: sem
  policy SELECT em storage.objects, a listagem via API permanece negada.
- Ownership: o path é plano (sem pasta por usuário), no formato
  avatar_<userId>_<timestamp>.jpg. A policy valida o UUID entre o primeiro
  e o segundo '_' contra auth.uid(). Nomes fora do formato falham fechado
  (split_part retorna '' ou UUID alheio, nunca o próprio uid).
- upsert:true exige INSERT + UPDATE: o SDK tenta INSERT e, em conflito de
  path (ex.: retry no mesmo milissegundo), faz UPDATE. Ambas as policies
  usam a mesma trava de dono.
- NÃO cria policy SELECT (leitura é pública; listagem fica negada).
- NÃO cria policy DELETE (o app não remove avatars).
- Idempotente: bucket via ON CONFLICT, policies via DROP IF EXISTS +
  CREATE (padrão do projeto). Não apaga policies de outros buckets e não
  toca em nenhuma tabela da aplicação.
- Escopo exclusivo: storage.buckets + storage.objects (bucket avatars).
============================================================================
*/

-- ---------------------------------------------------------------------------
-- 1. BUCKET avatars (público; teto 5 MB; somente JPEG)
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', true, 5242880, ARRAY['image/jpeg'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 2. INSERT: somente o dono, somente no path avatar_<uid>_*.jpg
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Avatar owner can insert own files" ON storage.objects;
CREATE POLICY "Avatar owner can insert own files" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND split_part(name, '_', 2) = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- 3. UPDATE: mesma trava de dono (cobre o ramo de conflito do upsert:true)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Avatar owner can update own files" ON storage.objects;
CREATE POLICY "Avatar owner can update own files" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND split_part(name, '_', 2) = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND split_part(name, '_', 2) = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- INTENCIONALMENTE AUSENTE (não conceder o que o app não usa):
-- - SELECT em storage.objects: leitura é pública via getPublicUrl; sem
--   policy SELECT, a listagem via API permanece negada.
-- - DELETE em storage.objects: o app não remove avatars.
-- - LIST/DOWNLOAD/COPY/MOVE dedicados: o app não usa essas operações.
-- ---------------------------------------------------------------------------
