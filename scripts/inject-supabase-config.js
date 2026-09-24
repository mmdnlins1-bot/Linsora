/**
 * LINSORA — Injeção de configuração pública do Supabase no build WEB.
 *
 * Lê SOMENTE as variáveis públicas:
 *   LINSORA_SUPABASE_URL
 *   LINSORA_SUPABASE_ANON_KEY
 * e preenche as meta tags `linsora:supabase-url` / `linsora:supabase-anon-key`
 * na cópia de `index.html` gerada em `dist/`.
 *
 * - O código-fonte mantém apenas placeholders (`content=""`); nada é gravado no Git.
 * - NUNCA usa `service_role` (nem mesmo lê essa variável).
 * - Sem as variáveis, o build mantém os placeholders vazios (comportamento seguro:
 *   o app segue sem cliente Supabase, como antes).
 * - Valores nunca são impressos nos logs (apenas presença/ausência).
 *
 * Uso local:  LINSORA_SUPABASE_URL=... LINSORA_SUPABASE_ANON_KEY=... node scripts/inject-supabase-config.js
 * Vercel:     vercel.json executa este script como buildCommand (env vars de Production).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

// Arquivos/pastas estáticos que compõem o app web (mesmo conjunto servido em dev).
const STATIC_ENTRIES = [
  'index.html',
  'offline.html',
  'manifest.webmanifest',
  'sw.js',
  'icon-192.png',
  'icon-512.png',
  'css',
  'js',
  'assets',
];

const PLACEHOLDER_URL = '<meta name="linsora:supabase-url" content="">';
const PLACEHOLDER_KEY = '<meta name="linsora:supabase-anon-key" content="">';

function escapeHtmlAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function isPlausibleUrl(value) {
  return /^https:\/\/[A-Za-z0-9.-]+(\/.*)?$/.test(value);
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function main() {
  const supabaseUrl = (process.env.LINSORA_SUPABASE_URL || '').trim();
  const anonKey = (process.env.LINSORA_SUPABASE_ANON_KEY || '').trim();

  // Limpa o diretório de saída para não publicar arquivos obsoletos.
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  for (const entry of STATIC_ENTRIES) {
    const src = path.join(ROOT, entry);
    if (!fs.existsSync(src)) {
      console.log(`[linsora-build] aviso: entrada não encontrada, ignorada: ${entry}`);
      continue;
    }
    copyRecursive(src, path.join(DIST, entry));
  }

  const indexPath = path.join(DIST, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');
  let urlInjected = false;
  let keyInjected = false;

  if (supabaseUrl && isPlausibleUrl(supabaseUrl) && html.includes(PLACEHOLDER_URL)) {
    html = html.replace(
      PLACEHOLDER_URL,
      `<meta name="linsora:supabase-url" content="${escapeHtmlAttr(supabaseUrl)}">`
    );
    urlInjected = true;
  }
  if (anonKey && html.includes(PLACEHOLDER_KEY)) {
    html = html.replace(
      PLACEHOLDER_KEY,
      `<meta name="linsora:supabase-anon-key" content="${escapeHtmlAttr(anonKey)}">`
    );
    keyInjected = true;
  }

  fs.writeFileSync(indexPath, html);

  // Log seguro: presença/ausência apenas, nunca valores.
  console.log(
    `[linsora-build] dist gerado. supabase-url=${urlInjected ? 'injetada' : 'ausente (placeholder mantido)'}; ` +
    `anon-key=${keyInjected ? 'injetada' : 'ausente (placeholder mantido)'}.`
  );
  if ((supabaseUrl && !urlInjected) || (anonKey && !keyInjected)) {
    console.log('[linsora-build] aviso: variável definida mas placeholder não encontrado ou URL inválida; nada foi inventado.');
  }
}

main();
