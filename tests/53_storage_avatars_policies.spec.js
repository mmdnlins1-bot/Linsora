const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// 53. Policies do bucket avatars (estático, READ-ONLY).
// Lê supabase_migration_storage_avatars.sql como texto e simula a lógica
// da policy em JS. Sem banco, sem credenciais, sem execução de SQL.

const UID_A = '550e8400-e29b-41d3-a716-446614174000';
const UID_B = '123e4567-e89b-42d3-a456-426614174999';

function repoRoot() {
  return path.resolve(__dirname, '..');
}

function readMigration() {
  return fs.readFileSync(path.join(repoRoot(), 'supabase_migration_storage_avatars.sql'), 'utf8');
}

// Semântica de split_part(name, '_', 2): 2º campo, ou '' se não houver.
function splitPart2(name) {
  const parts = String(name).split('_');
  return parts.length >= 2 ? parts[1] : '';
}

// Predicado da policy para um usuário autenticado (bucket + dono no path).
function ownerAllowed(name, uid) {
  return splitPart2(name) === String(uid);
}

test.describe('53. Policies do bucket avatars', () => {
  test('bucket: nome, público, limite 5 MB e somente JPEG', async () => {
    const sql = readMigration();
    expect(sql).toContain("VALUES ('avatars', 'avatars', true, 5242880, ARRAY['image/jpeg'])");
    expect(sql).toContain('ON CONFLICT (id) DO UPDATE');
  });

  test('INSERT: só authenticated, com trava de dono, sem anon', async () => {
    const sql = readMigration();
    expect(sql).toMatch(/CREATE POLICY "Avatar owner can insert own files" ON storage\.objects[\s\S]*?FOR INSERT TO authenticated[\s\S]*?WITH CHECK \(\s*bucket_id = 'avatars'\s*AND split_part\(name, '_', 2\) = auth\.uid\(\)::text\s*\)/);
    expect(sql).not.toMatch(/FOR INSERT TO (anon|public)\b/);
  });

  test('UPDATE: USING + WITH CHECK de dono, sem anon (cobre upsert:true)', async () => {
    const sql = readMigration();
    expect(sql).toMatch(/CREATE POLICY "Avatar owner can update own files" ON storage\.objects[\s\S]*?FOR UPDATE TO authenticated[\s\S]*?USING \([\s\S]*?split_part\(name, '_', 2\) = auth\.uid\(\)::text[\s\S]*?\)[\s\S]*?WITH CHECK \([\s\S]*?split_part\(name, '_', 2\) = auth\.uid\(\)::text[\s\S]*?\)/);
    expect(sql).not.toMatch(/FOR UPDATE TO (anon|public)\b/);
  });

  test('sem SELECT e sem DELETE para o bucket', async () => {
    const sql = readMigration();
    expect(sql).not.toMatch(/FOR SELECT/i);
    expect(sql).not.toMatch(/FOR DELETE/i);
  });

  test('escopo: só storage, sem tabelas da aplicação', async () => {
    const sql = readMigration();
    expect(sql).toContain('storage.buckets');
    expect(sql).toContain('storage.objects');
    for (const table of ['public.profiles', 'public.subscriptions', 'public.transactions', 'public.accounts', 'auth.users']) {
      expect(sql).not.toContain(table);
    }
    expect(sql).not.toMatch(/CREATE TABLE/i);
    expect(sql).not.toMatch(/ALTER TABLE/i);
  });

  test('1. A pode inserir avatar_<A>_ts.jpg', async () => {
    expect(ownerAllowed(`avatar_${UID_A}_1728380000000.jpg`, UID_A)).toBe(true);
  });

  test('2. A pode atualizar seu próprio objeto (mesmo predicado)', async () => {
    expect(ownerAllowed(`avatar_${UID_A}_1728380000000.jpg`, UID_A)).toBe(true);
  });

  test('3. A NÃO insere objeto com UUID de B', async () => {
    expect(ownerAllowed(`avatar_${UID_B}_1728380000000.jpg`, UID_A)).toBe(false);
  });

  test('4. A NÃO atualiza objeto com UUID de B', async () => {
    expect(ownerAllowed(`avatar_${UID_B}_1728380000000.jpg`, UID_A)).toBe(false);
  });

  test('5. nome sem UUID válido falha fechado', async () => {
    expect(ownerAllowed('foto.jpg', UID_A)).toBe(false);
    expect(ownerAllowed('avatar_.jpg', UID_A)).toBe(false);
    expect(ownerAllowed('', UID_A)).toBe(false);
  });

  test('6/7. anon sem INSERT/UPDATE (policies só TO authenticated)', async () => {
    const sql = readMigration();
    const policyTargets = [...sql.matchAll(/FOR (?:INSERT|UPDATE|SELECT|DELETE) TO (\w+)/g)].map((m) => m[1]);
    expect(policyTargets.length).toBeGreaterThan(0);
    expect(policyTargets.every((role) => role === 'authenticated')).toBe(true);
  });

  test('8/9. sem DELETE nem SELECT criados', async () => {
    const sql = readMigration();
    expect(sql).not.toMatch(/CREATE POLICY[\s\S]*?FOR (DELETE|SELECT)/i);
  });
});
