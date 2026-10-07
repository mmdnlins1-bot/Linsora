const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// 49. Icones PWA do Linsora — arquitetura any vs maskable.
// Garante que o app instalado nao exiba quadrado preto/branco externo:
// manifest declara any + maskable separados, sizes reais, sem conflitos,
// SW/cache na versao atual e HTML apontando para os arquivos canonicos.

const ROOT = path.resolve(__dirname, '..');

function readPngInfo(absPath) {
  const buf = fs.readFileSync(absPath);
  expect(buf.slice(0, 8).toString('hex'), `${absPath} assinatura PNG`).toBe('89504e470d0a1a0a');
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf[24];
  const colorType = buf[25];
  return { width, height, bitDepth, colorType };
}

function loadManifest() {
  const raw = fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8');
  return JSON.parse(raw);
}

test.describe('49. Icones PWA do Linsora', () => {
  test('1. manifest JSON valido com any + maskable separados', () => {
    const manifest = loadManifest();
    expect(Array.isArray(manifest.icons), 'manifest.icons deve ser array').toBe(true);
    expect(manifest.icons.length, 'manifest deve declarar 4 icones').toBeGreaterThanOrEqual(4);
    const purposes = manifest.icons.map((i) => i.purpose);
    expect(purposes, 'deve existir purpose=any').toContain('any');
    expect(purposes, 'deve existir purpose=maskable').toContain('maskable');
    for (const icon of manifest.icons) {
      expect(icon.purpose, `purpose combinado proibido em ${icon.src}`).not.toBe('any maskable');
      expect(icon.purpose, `purpose combinado proibido em ${icon.src}`).not.toBe('maskable any');
    }
  });

  test('2. todo src do manifest existe e sizes corresponde ao PNG real', () => {
    const manifest = loadManifest();
    const seen = new Set();
    for (const icon of manifest.icons) {
      expect(icon.type, `type de ${icon.src}`).toBe('image/png');
      const key = `${icon.src}|${icon.sizes}|${icon.purpose}`;
      expect(seen.has(key), `referencia duplicada: ${key}`).toBe(false);
      seen.add(key);
      const rel = icon.src.replace(/^\.\//, '');
      const abs = path.join(ROOT, rel);
      expect(fs.existsSync(abs), `arquivo do manifest deve existir: ${icon.src}`).toBe(true);
      const info = readPngInfo(abs);
      expect(`${info.width}x${info.height}`, `sizes de ${icon.src} deve ser real`).toBe(icon.sizes);
    }
  });

  test('3. PNGs sao opacos (sem alpha que gere moldura branca)', () => {
    const manifest = loadManifest();
    for (const icon of manifest.icons) {
      const abs = path.join(ROOT, icon.src.replace(/^\.\//, ''));
      const info = readPngInfo(abs);
      // colorType 2 = RGB opaco; 6 = RGBA (proibido aqui pois transparencia
      // externa faz o SO compor sobre branco/preto).
      expect(info.colorType, `${icon.src} deve ser RGB opaco (colorType 2)`).toBe(2);
    }
    // apple-touch-icon tambem deve ser opaco e 180x180.
    const apple = path.join(ROOT, 'assets', 'apple-touch-icon-180.png');
    const appleInfo = readPngInfo(apple);
    expect(`${appleInfo.width}x${appleInfo.height}`).toBe('180x180');
    expect(appleInfo.colorType).toBe(2);
  });

  test('4. sem referencias a icones antigos/conflitantes', () => {
    const manifest = loadManifest();
    const srcs = manifest.icons.map((i) => i.src);
    for (const src of srcs) {
      expect(src.includes('pwa-icon'), `referencia antiga proibida: ${src}`).toBe(false);
      // Manifest deve usar apenas o diretorio canonico assets/.
      expect(src.startsWith('./assets/'), `manifest deve apontar para ./assets/: ${src}`).toBe(true);
    }
    // 192 e 512 devem existir em ambas as finalidades.
    const has = (sizes, purpose) =>
      srcs.some((_, idx) => manifest.icons[idx].sizes === sizes && manifest.icons[idx].purpose === purpose);
    expect(has('192x192', 'any')).toBe(true);
    expect(has('512x512', 'any')).toBe(true);
    expect(has('192x192', 'maskable')).toBe(true);
    expect(has('512x512', 'maskable')).toBe(true);
  });

  test('5. service worker com cache versionado incluindo os icones novos', () => {
    const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    expect(sw.includes("CACHE_NAME = 'linsora-v6'"), 'SW deve estar na versao linsora-v6').toBe(true);
    expect(sw.includes('linsora-v5'), 'SW nao deve referenciar cache antigo v5').toBe(false);
    for (const expected of [
      './assets/icon-192.png',
      './assets/icon-512.png',
      './assets/icon-maskable-192.png',
      './assets/icon-maskable-512.png',
      './assets/apple-touch-icon-180.png',
    ]) {
      expect(sw.includes(expected), `SW deve cachear ${expected}`).toBe(true);
    }
    // Nenhum asset do SW pode apontar para arquivo inexistente.
    const listed = sw.match(/'\.\/[^']+\.(png|html|css|js|webmanifest)'/g) || [];
    expect(listed.length).toBeGreaterThan(0);
    for (const quoted of listed) {
      const rel = quoted.slice(1, -1).replace(/^\.\//, '');
      expect(fs.existsSync(path.join(ROOT, rel)), `asset do SW deve existir: ${rel}`).toBe(true);
    }
  });

  test('6. HTMLs apontam para os icones canonicos', () => {
    const pages = ['index.html', 'landing.html', 'bemvindo.html', 'reset-password.html', 'offline.html'];
    for (const page of pages) {
      const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
      expect(html.includes('assets/apple-touch-icon-180.png'), `${page} deve referenciar apple-touch-icon-180`).toBe(true);
      expect(html.includes('href="./icon-192.png"'), `${page} nao deve referenciar ./icon-192.png como favicon`).toBe(false);
      expect(html.includes('href="icon-192.png"'), `${page} nao deve referenciar icon-192.png como favicon`).toBe(false);
    }
    const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    expect(index.includes('rel="manifest"'), 'index deve declarar manifest').toBe(true);
    expect(index.includes('assets/icon-192.png')).toBe(true);
    expect(index.includes('assets/icon-512.png')).toBe(true);
  });

  test('7. manifest servido via HTTP com icones acessiveis', async ({ request }) => {
    const manifestRes = await request.get('/manifest.webmanifest');
    expect(manifestRes.ok(), 'GET /manifest.webmanifest deve ser 200').toBe(true);
    const manifest = await manifestRes.json();
    for (const icon of manifest.icons) {
      const url = icon.src.replace(/^\.\//, '/');
      const res = await request.get(url);
      expect(res.ok(), `GET ${url} deve ser 200`).toBe(true);
      const headers = res.headers();
      expect(headers['content-type'] || '', `content-type de ${url}`).toContain('image/png');
    }
  });
});
