const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// 49. Icones PWA do Linsora — arquitetura any vs maskable.
// Valida separadamente:
//  - any: RGBA com transparencia real fora da forma (sem moldura preta no desktop)
//  - maskable: RGB 100% opaco full-bleed sem cantos pre-arredondados e seguro para cortes de SO
//  - apple-touch-icon: 180x180 RGB opaco full-bleed (iOS aplica sua propria superelipse)
//  - favicon: 32x32 dedicado e legivel em abas
//  - manifest, service worker (linsora-v7) e HTMLs apontando para os icones canonicos

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

function decodePngPixels(absPath) {
  const buf = fs.readFileSync(absPath);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const colorType = buf[25];

  let pos = 8;
  const idats = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    if (type === 'IDAT') idats.push(buf.slice(pos + 8, pos + 8 + len));
    pos += 12 + len;
  }
  const decompressed = zlib.inflateSync(Buffer.concat(idats));
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const stride = 1 + width * bpp;

  const raw = Buffer.alloc(width * height * bpp);
  let prevRow = Buffer.alloc(width * bpp);

  for (let y = 0; y < height; y++) {
    const filter = decompressed[y * stride];
    const row = decompressed.slice(y * stride + 1, (y + 1) * stride);
    const curRow = Buffer.alloc(width * bpp);

    for (let x = 0; x < width * bpp; x++) {
      const a = x >= bpp ? curRow[x - bpp] : 0;
      const b = prevRow[x];
      const c = x >= bpp ? prevRow[x - bpp] : 0;
      let val = row[x];

      if (filter === 1) val = (val + a) & 0xff;
      else if (filter === 2) val = (val + b) & 0xff;
      else if (filter === 3) val = (val + Math.floor((a + b) / 2)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc) ? b : c;
        val = (val + pr) & 0xff;
      }
      curRow[x] = val;
    }
    curRow.copy(raw, y * width * bpp);
    prevRow = curRow;
  }

  const sample = (x, y) => {
    const idx = (y * width + x) * bpp;
    if (bpp === 4) {
      return { r: raw[idx], g: raw[idx + 1], b: raw[idx + 2], a: raw[idx + 3] };
    }
    return { r: raw[idx], g: raw[idx + 1], b: raw[idx + 2], a: 255 };
  };

  return { width, height, colorType, sample };
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

  test('3. icones any possuem transparencia externa real (RGBA)', () => {
    const manifest = loadManifest();
    const anyIcons = manifest.icons.filter((i) => i.purpose === 'any');
    expect(anyIcons.length).toBeGreaterThanOrEqual(2);

    for (const icon of anyIcons) {
      const abs = path.join(ROOT, icon.src.replace(/^\.\//, ''));
      const decoded = decodePngPixels(abs);
      // colorType 6 = RGBA com canal alfa real
      expect(decoded.colorType, `${icon.src} deve ser RGBA (colorType 6)`).toBe(6);

      // Cantos externos devem ser transparentes (alpha === 0) para nao gerar bloco preto no Desktop
      const topLeft = decoded.sample(0, 0);
      const topRight = decoded.sample(decoded.width - 1, 0);
      const bottomLeft = decoded.sample(0, decoded.height - 1);
      const bottomRight = decoded.sample(decoded.width - 1, decoded.height - 1);

      expect(topLeft.a, `${icon.src} canto superior esquerdo deve ser transparente`).toBe(0);
      expect(topRight.a, `${icon.src} canto superior direito deve ser transparente`).toBe(0);
      expect(bottomLeft.a, `${icon.src} canto inferior esquerdo deve ser transparente`).toBe(0);
      expect(bottomRight.a, `${icon.src} canto inferior direito deve ser transparente`).toBe(0);

      // Centro deve ser opaco (alpha === 255)
      const center = decoded.sample(Math.floor(decoded.width / 2), Math.floor(decoded.height / 2));
      expect(center.a, `${icon.src} centro deve ser opaco`).toBe(255);
    }
  });

  test('4. icones maskable sao 100% opacos com fundo full-bleed e safe zone preservada', () => {
    const manifest = loadManifest();
    const maskableIcons = manifest.icons.filter((i) => i.purpose === 'maskable');
    expect(maskableIcons.length).toBeGreaterThanOrEqual(2);

    for (const icon of maskableIcons) {
      const abs = path.join(ROOT, icon.src.replace(/^\.\//, ''));
      const decoded = decodePngPixels(abs);
      // colorType 2 = RGB opaco sem canal alfa (impede halo branco no Android)
      expect(decoded.colorType, `${icon.src} deve ser RGB opaco (colorType 2)`).toBe(2);

      // Fundo deve ser full-bleed ate os 4 cantos: os cantos possuem cor esmeralda do tema (verde dominante, nao preto puro)
      const corners = [
        decoded.sample(0, 0),
        decoded.sample(decoded.width - 1, 0),
        decoded.sample(0, decoded.height - 1),
        decoded.sample(decoded.width - 1, decoded.height - 1),
      ];
      for (const [idx, c] of corners.entries()) {
        expect(c.a, `${icon.src} canto ${idx} deve ser opaco`).toBe(255);
        expect(c.g, `${icon.src} canto ${idx} deve ter verde dominante (fundo esmeralda full-bleed)`).toBeGreaterThan(20);
      }

      // Safe zone central (80% de diametro): o centro possui o simbolo Linsora opaco
      const center = decoded.sample(Math.floor(decoded.width / 2), Math.floor(decoded.height / 2));
      expect(center.a).toBe(255);
    }
  });

  test('5. apple-touch-icon e favicon-32 possuem especificacoes corretas', () => {
    // apple-touch-icon: 180x180, RGB opaco full-bleed
    const applePath = path.join(ROOT, 'assets', 'apple-touch-icon-180.png');
    expect(fs.existsSync(applePath), 'apple-touch-icon-180.png deve existir').toBe(true);
    const apple = decodePngPixels(applePath);
    expect(`${apple.width}x${apple.height}`).toBe('180x180');
    expect(apple.colorType).toBe(2);
    expect(apple.sample(0, 0).g, 'canto do apple-touch-icon deve ser esmeralda full-bleed').toBeGreaterThan(20);

    // favicon-32: 32x32 dedicado
    const favPath = path.join(ROOT, 'assets', 'favicon-32.png');
    expect(fs.existsSync(favPath), 'favicon-32.png deve existir').toBe(true);
    const fav = readPngInfo(favPath);
    expect(`${fav.width}x${fav.height}`).toBe('32x32');
    expect(fav.colorType).toBe(6);
  });

  test('6. sem referencias a icones antigos/conflitantes', () => {
    const manifest = loadManifest();
    const srcs = manifest.icons.map((i) => i.src);
    for (const src of srcs) {
      expect(src.includes('pwa-icon'), `referencia antiga proibida: ${src}`).toBe(false);
      expect(src.startsWith('./assets/'), `manifest deve apontar para ./assets/: ${src}`).toBe(true);
    }
    const has = (sizes, purpose) =>
      srcs.some((_, idx) => manifest.icons[idx].sizes === sizes && manifest.icons[idx].purpose === purpose);
    expect(has('192x192', 'any')).toBe(true);
    expect(has('512x512', 'any')).toBe(true);
    expect(has('192x192', 'maskable')).toBe(true);
    expect(has('512x512', 'maskable')).toBe(true);
  });

  test('7. service worker com cache versionado linsora-v7 incluindo os icones novos', () => {
    const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    expect(sw.includes("CACHE_NAME = 'linsora-v7'"), 'SW deve estar na versao linsora-v7').toBe(true);
    expect(sw.includes('linsora-v6'), 'SW nao deve referenciar cache antigo v6').toBe(false);
    expect(sw.includes('linsora-v5'), 'SW nao deve referenciar cache antigo v5').toBe(false);
    for (const expected of [
      './assets/favicon-32.png',
      './assets/icon-192.png',
      './assets/icon-512.png',
      './assets/icon-maskable-192.png',
      './assets/icon-maskable-512.png',
      './assets/apple-touch-icon-180.png',
    ]) {
      expect(sw.includes(expected), `SW deve cachear ${expected}`).toBe(true);
    }
    const listed = sw.match(/'\.\/[^']+\.(png|html|css|js|webmanifest)'/g) || [];
    expect(listed.length).toBeGreaterThan(0);
    for (const quoted of listed) {
      const rel = quoted.slice(1, -1).replace(/^\.\//, '');
      expect(fs.existsSync(path.join(ROOT, rel)), `asset do SW deve existir: ${rel}`).toBe(true);
    }
  });

  test('8. HTMLs apontam para os icones canonicos incluindo favicon-32', () => {
    const pages = ['index.html', 'landing.html', 'bemvindo.html', 'reset-password.html', 'offline.html'];
    for (const page of pages) {
      const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
      expect(html.includes('assets/favicon-32.png'), `${page} deve referenciar favicon-32.png`).toBe(true);
      expect(html.includes('assets/apple-touch-icon-180.png'), `${page} deve referenciar apple-touch-icon-180`).toBe(true);
      expect(html.includes('href="./icon-192.png"'), `${page} nao deve referenciar ./icon-192.png como favicon`).toBe(false);
      expect(html.includes('href="icon-192.png"'), `${page} nao deve referenciar icon-192.png como favicon`).toBe(false);
    }
    const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    expect(index.includes('rel="manifest"'), 'index deve declarar manifest').toBe(true);
    expect(index.includes('assets/icon-192.png')).toBe(true);
    expect(index.includes('assets/icon-512.png')).toBe(true);
  });

  test('9. manifest servido via HTTP com icones acessiveis', async ({ request }) => {
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
    // Verifica tambem favicon
    const favRes = await request.get('/assets/favicon-32.png');
    expect(favRes.ok(), 'GET /assets/favicon-32.png deve ser 200').toBe(true);
  });
});
