import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startServer } from './serve.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const screenshotsDir = path.join(rootDir, 'screenshots');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

function findChromeExecutable() {
  for (const candidate of CHROME_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Не найден локальный браузер Chrome/Chromium для снятия скриншотов.');
}

async function main() {
  fs.mkdirSync(screenshotsDir, { recursive: true });
  const serveTarget = fs.existsSync(distDir) ? distDir : rootDir;
  const { server, port } = await startServer(0, serveTarget);
  const baseUrl = `http://127.0.0.1:${port}`;

  const executablePath = findChromeExecutable();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
  });

  const externalRequests = [];
  const pageErrors = [];

  try {
    // 1. Десктопный экран 1440x900 (итоговый экран со всеми 3 слоями школы Балуты)
    const desktopCtx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    const desktopPage = await desktopCtx.newPage();

    desktopPage.on('request', (req) => {
      const url = req.url();
      if (
        !url.startsWith(baseUrl) &&
        !url.startsWith('blob:') &&
        !url.startsWith('data:')
      ) {
        externalRequests.push(url);
      }
    });
    desktopPage.on('pageerror', (err) => pageErrors.push(err.message));

    await desktopPage.goto(baseUrl, { waitUntil: 'networkidle' });
    await desktopPage.evaluate(() => document.fonts.ready);

    // Включаем также слой «Сетка наложения пад», чтобы на итоговом экране были видны все 3 слоя по ТЗ
    await desktopPage.locator('#togglePadas').check({ force: true });
    await desktopPage.waitForTimeout(250);

    const desktopPath = path.join(screenshotsDir, 'desktop-1440x900.png');
    await desktopPage.screenshot({ path: desktopPath });

    // Проверяем скачивание итогового PNG-файла с подписью «Васту-карта · Анна Ромео»
    const [download] = await Promise.all([
      desktopPage.waitForEvent('download'),
      desktopPage.locator('#exportPngBtn').click(),
    ]);
    const exportedSamplePath = path.join(screenshotsDir, 'exported-map-sample.png');
    await download.saveAs(exportedSamplePath);

    await desktopCtx.close();

    // 2. Мобильный экран 390x844 (iPhone / Android портретный режим)
    const mobileCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const mobilePage = await mobileCtx.newPage();

    mobilePage.on('request', (req) => {
      const url = req.url();
      if (
        !url.startsWith(baseUrl) &&
        !url.startsWith('blob:') &&
        !url.startsWith('data:')
      ) {
        externalRequests.push(url);
      }
    });
    mobilePage.on('pageerror', (err) => pageErrors.push(err.message));

    await mobilePage.goto(baseUrl, { waitUntil: 'networkidle' });
    await mobilePage.evaluate(() => document.fonts.ready);
    await mobilePage.locator('#togglePadas').check({ force: true });
    await mobilePage.waitForTimeout(250);

    const mobilePath = path.join(screenshotsDir, 'mobile-390x844.png');
    await mobilePage.screenshot({ path: mobilePath });

    await mobileCtx.close();

    if (externalRequests.length > 0) {
      throw new Error(
        `Обнаружены внешние сетевые запросы (нарушение автономности): ${externalRequests.join(', ')}`
      );
    }
    if (pageErrors.length > 0) {
      throw new Error(`Ошибки на странице: ${pageErrors.join('; ')}`);
    }

    console.log('Скриншоты успешно сохранены:');
    console.log(` - ${mobilePath}`);
    console.log(` - ${desktopPath}`);
    console.log(` - ${exportedSamplePath}`);
    console.log('Проверка автономности: 0 внешних запросов, 0 ошибок в консоли.');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
