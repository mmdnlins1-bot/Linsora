const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/auth');

// 52. Segurança do upload de avatar (sem Supabase real).
// Storage é substituído por um spy em memória; arquivos são gerados ou
// fabricados no próprio teste. Nenhum upload real, nenhum segredo.

const PNG_1PX_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const AVATAR_ERR_HINT = 'JPEG, PNG ou WebP';

test.describe('52. Segurança do upload de avatar', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.click('[data-tab="tabProfile"]');
    await expect(page.locator('#tabProfile')).toHaveClass(/active/);
  });

  // Instala o spy de Storage ANTES de escolher o arquivo e zera contadores.
  async function installStorageSpy(page) {
    await page.evaluate(() => {
      window.__avatarUploads = [];
      window.__compressCalls = 0;
      const origCompress = window.LinsoraUtils.processAndCompressImage;
      window.LinsoraUtils.processAndCompressImage = function (...args) {
        window.__compressCalls += 1;
        return origCompress.apply(this, args);
      };
      window.supabaseRepo.supabase = {
        storage: {
          from: () => ({
            upload: async (name, blob, opts) => {
              let magic = '';
              try {
                const buf = new Uint8Array(await blob.slice(0, 3).arrayBuffer());
                magic = Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join(' ');
              } catch (e) { magic = 'unreadable'; }
              window.__avatarUploads.push({
                name,
                type: blob.type,
                size: blob.size,
                contentType: opts && opts.contentType,
                magic,
              });
              return { data: { path: name }, error: null };
            },
            getPublicUrl: (name) => ({ data: { publicUrl: 'https://storage-ficticio/' + name } }),
          }),
        },
      };
    });
  }

  async function chooseFile(page, { name, mimeType, buffer }) {
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.click('#btnChangeAvatar');
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({ name, mimeType, buffer });
  }

  async function uploadStats(page) {
    return page.evaluate(() => ({
      uploads: window.__avatarUploads || [],
      compressCalls: window.__compressCalls || 0,
    }));
  }

  // Gera bytes de imagem válidos via canvas do próprio navegador.
  async function canvasImageBuffer(page, mime) {
    const dataUrl = await page.evaluate((m) => {
      const c = document.createElement('canvas');
      c.width = 8; c.height = 8;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#10B981';
      ctx.fillRect(0, 0, 8, 8);
      return c.toDataURL(m, 0.7);
    }, mime);
    return { dataUrl, buffer: Buffer.from(dataUrl.split(',')[1], 'base64') };
  }

  test('A. JPEG válido: aceita, processa e faz upload como JPEG', async ({ page }) => {
    const { buffer } = await canvasImageBuffer(page, 'image/jpeg');
    await installStorageSpy(page);
    await chooseFile(page, { name: 'foto.jpg', mimeType: 'image/jpeg', buffer });
    await expect(page.locator('.toast.success')).toBeVisible({ timeout: 8000 });
    const stats = await uploadStats(page);
    expect(stats.uploads).toHaveLength(1);
    expect(stats.uploads[0].name).toMatch(/\.jpg$/);
    expect(stats.uploads[0].type).toBe('image/jpeg');
    expect(stats.uploads[0].contentType).toBe('image/jpeg');
    expect(stats.uploads[0].magic).toBe('ff d8 ff');
  });

  test('B. PNG válido: aceita e transforma em JPEG', async ({ page }) => {
    await installStorageSpy(page);
    await chooseFile(page, {
      name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from(PNG_1PX_B64, 'base64'),
    });
    await expect(page.locator('.toast.success')).toBeVisible({ timeout: 8000 });
    const stats = await uploadStats(page);
    expect(stats.uploads).toHaveLength(1);
    expect(stats.uploads[0].type).toBe('image/jpeg');
    expect(stats.uploads[0].magic).toBe('ff d8 ff');
  });

  test('C. WebP válido: aceita e transforma em JPEG', async ({ page }) => {
    const { dataUrl, buffer } = await canvasImageBuffer(page, 'image/webp');
    if (dataUrl.indexOf('data:image/webp') !== 0) test.skip(true, 'navegador sem encode WebP');
    await installStorageSpy(page);
    await chooseFile(page, { name: 'foto.webp', mimeType: 'image/webp', buffer });
    await expect(page.locator('.toast.success')).toBeVisible({ timeout: 8000 });
    const stats = await uploadStats(page);
    expect(stats.uploads).toHaveLength(1);
    expect(stats.uploads[0].type).toBe('image/jpeg');
    expect(stats.uploads[0].magic).toBe('ff d8 ff');
  });

  test('D. arquivo maior que 5 MB: rejeita antes do processamento, sem upload', async ({ page }) => {
    await installStorageSpy(page);
    await chooseFile(page, {
      name: 'grande.png', mimeType: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
    });
    const errToast = page.locator('.toast.error');
    await expect(errToast).toBeVisible({ timeout: 8000 });
    await expect(errToast).toContainText(AVATAR_ERR_HINT);
    const stats = await uploadStats(page);
    expect(stats.compressCalls).toBe(0);
    expect(stats.uploads).toHaveLength(0);
  });

  test('E. PDF renomeado como .jpg: rejeita, sem upload', async ({ page }) => {
    await installStorageSpy(page);
    await chooseFile(page, {
      name: 'foto.jpg', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%ficticio\n'),
    });
    const errToast = page.locator('.toast.error');
    await expect(errToast).toBeVisible({ timeout: 8000 });
    await expect(errToast).toContainText(AVATAR_ERR_HINT);
    const stats = await uploadStats(page);
    expect(stats.compressCalls).toBe(0);
    expect(stats.uploads).toHaveLength(0);
  });

  test('F. MIME adulterado (lixo como image/png): canvas rejeita, sem upload', async ({ page }) => {
    await installStorageSpy(page);
    await chooseFile(page, {
      name: 'falsa.png', mimeType: 'image/png', buffer: Buffer.from('isto-nao-e-uma-imagem-valida-1234567890'),
    });
    const errToast = page.locator('.toast.error');
    await expect(errToast).toBeVisible({ timeout: 8000 });
    await expect(errToast).toContainText(AVATAR_ERR_HINT);
    const stats = await uploadStats(page);
    expect(stats.uploads).toHaveLength(0);
  });

  test('G. MIME vazio: rejeita, sem upload', async ({ page }) => {
    await installStorageSpy(page);
    await chooseFile(page, {
      name: 'sem-mime', mimeType: '', buffer: Buffer.from(PNG_1PX_B64, 'base64'),
    });
    const errToast = page.locator('.toast.error');
    await expect(errToast).toBeVisible({ timeout: 8000 });
    await expect(errToast).toContainText(AVATAR_ERR_HINT);
    const stats = await uploadStats(page);
    expect(stats.compressCalls).toBe(0);
    expect(stats.uploads).toHaveLength(0);
  });

  test('H. falha de decodificação: processAndCompressImage rejeita (sem fallback)', async ({ page }) => {
    const outcome = await page.evaluate(async () => {
      const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      const file = new File([bytes], 'lixo.png', { type: 'image/png' });
      try {
        const out = await window.LinsoraUtils.processAndCompressImage(file, 400, 400, 0.7);
        return { rejected: false, prefix: String(out).slice(0, 30) };
      } catch (e) {
        return { rejected: true };
      }
    });
    expect(outcome.rejected).toBe(true);
  });
});
