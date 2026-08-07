// @ts-check
const { defineConfig, devices } = require('@playwright/test');

/**
 * Configuração Principal do Playwright para o LINSORA Web App
 * @see https://playwright.dev/docs/test-configuration
 */
module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: false, // Execução sequencial para evitar concorrência de LocalStorage
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['html'], ['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1280, height: 800 }
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    }
  ],

  /* Iniciar o servidor HTTP nativo automaticamente caso não esteja rodando */
  webServer: {
    command: 'powershell -ExecutionPolicy Bypass -File .\\server.ps1',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 10000
  }
});
