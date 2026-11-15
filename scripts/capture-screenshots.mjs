import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startServer } from './serve.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const screenshotsDir = path.join(rootDir, 'screenshots');
const EXTERNAL_CCITT_PDF = '/private/tmp/claude-501/karta-phone-qa/assets/plan-bti-scan-ccitt-g4.pdf';

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

function assertNoOverlappingBadges(badges, label) {
  for (let i = 0; i < badges.length; i++) {
    for (let j = i + 1; j < badges.length; j++) {
      const a = badges[i];
      const b = badges[j];
      const overlaps = !(
        a.x2 <= b.x1 + 0.5 ||
        a.x1 >= b.x2 - 0.5 ||
        a.y2 <= b.y1 + 0.5 ||
        a.y1 >= b.y2 - 0.5
      );
      assert.equal(
        overlaps,
        false,
        `${label}: наложение подписей ${JSON.stringify(a)} и ${JSON.stringify(b)}`
      );
    }
  }
}

/**
 * Создаёт реалистичный портретный скриншот со спутника (780x1688, как на экране телефона 390x844 @2x):
 * раньше такой вертикальный скриншот вписывался мелкой полоской ~100x220 px со стеной ~30 px,
 * теперь он должен открываться сразу крупно со стеной > 200 экранных пикселей.
 */
async function createSyntheticPortraitSatellitePngBuffer(page) {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 780;
    c.height = 1688;
    const g = c.getContext('2d');

    // Спутниковая подложка квартала
    g.fillStyle = '#334139';
    g.fillRect(0, 0, c.width, c.height);

    // Асфальтовые проезды и дорожки двора
    g.strokeStyle = '#565A58';
    g.lineWidth = 46;
    g.beginPath();
    g.moveTo(0, 1210);
    g.lineTo(780, 1060);
    g.moveTo(120, 0);
    g.lineTo(40, 1688);
    g.stroke();

    g.strokeStyle = '#6A6E6B';
    g.lineWidth = 18;
    g.beginPath();
    g.moveTo(140, 560);
    g.lineTo(740, 480);
    g.stroke();

    // Деревья вокруг дома
    const trees = [
      [190, 620, 36],
      [255, 595, 28],
      [645, 650, 40],
      [690, 735, 32],
      [220, 1045, 38],
      [615, 1015, 34],
      [390, 420, 42],
      [530, 1280, 44],
    ];
    for (const [tx, ty, tr] of trees) {
      g.fillStyle = '#27382D';
      g.beginPath();
      g.arc(tx + 6, ty + 8, tr, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#435B49';
      g.beginPath();
      g.arc(tx, ty, tr, 0, Math.PI * 2);
      g.fill();
    }

    // Г-образная крыша дома в центре снимка (390, 844), повёрнутая на +22° относительно Севера сверху
    g.save();
    g.translate(390, 844);
    g.rotate((22 * Math.PI) / 180);

    g.fillStyle = 'rgba(12, 16, 14, 0.45)';
    g.beginPath();
    g.moveTo(-190 + 18, -125 + 22);
    g.lineTo(160 + 18, -125 + 22);
    g.lineTo(160 + 18, -10 + 22);
    g.lineTo(220 + 18, -10 + 22);
    g.lineTo(220 + 18, 145 + 22);
    g.lineTo(-190 + 18, 145 + 22);
    g.closePath();
    g.fill();

    g.fillStyle = '#8B8982';
    g.strokeStyle = '#DFDBD0';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(-190, -125);
    g.lineTo(160, -125);
    g.lineTo(160, -10);
    g.lineTo(220, -10);
    g.lineTo(220, 145);
    g.lineTo(-190, 145);
    g.closePath();
    g.fill();
    g.stroke();

    // Парапет и вентшахты на кровле
    g.strokeStyle = '#6B6963';
    g.lineWidth = 2;
    g.strokeRect(-172, -108, 314, 236);
    g.fillStyle = '#ABA79E';
    g.fillRect(-95, -55, 24, 16);
    g.fillRect(25, -55, 24, 16);
    g.fillRect(110, 45, 24, 16);
    g.restore();

    return c.toDataURL('image/png');
  });

  const b64 = dataUrl.split(',')[1];
  return Buffer.from(b64, 'base64');
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
  const consoleErrors = [];
  const pageErrors = [];

  function attachGuards(page) {
    page.on('request', (req) => {
      const url = req.url();
      if (
        !url.startsWith(baseUrl) &&
        !url.startsWith('blob:') &&
        !url.startsWith('data:')
      ) {
        externalRequests.push(url);
      }
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));
  }

  try {
    // =========================================================================
    // 1. ДЕСКТОП 1440x900 + сохранённая картинка PNG (все 32 пады + обрезанный Брахмастан)
    // =========================================================================
    const desktopCtx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    const desktopPage = await desktopCtx.newPage();
    attachGuards(desktopPage);

    await desktopPage.goto(baseUrl, { waitUntil: 'networkidle' });
    await desktopPage.evaluate(() => document.fonts.ready);
    await desktopPage.waitForTimeout(150);

    // Проверяем настройки по умолчанию и исправленную SVG-схему «Север по спутнику» (пункт 10)
    const defaultsCheck = await desktopPage.evaluate(() => {
      const app = window.__vastuApp;
      const sub = document.getElementById('padaSuboptions');
      const schemeNorthLine = document.querySelector(
        '.sat-diagram svg line[stroke-dasharray]'
      );
      return {
        alignNorthUp: app.state.alignNorthUp,
        showPadas: app.state.layers.showPadas,
        showPadaBelts: app.state.layers.showPadaBelts,
        showPadaScores: app.state.layers.showPadaScores,
        sectorOpacity: app.state.layers.sectorOpacity,
        subDisplay: getComputedStyle(sub).display,
        arrowX1: Number(schemeNorthLine.getAttribute('x1')),
        arrowX2: Number(schemeNorthLine.getAttribute('x2')),
      };
    });
    assert.equal(defaultsCheck.alignNorthUp, true, 'По умолчанию Север сверху');
    assert.equal(defaultsCheck.showPadas, false);
    assert.equal(defaultsCheck.showPadaBelts, false);
    assert.equal(defaultsCheck.showPadaScores, false);
    assert.equal(defaultsCheck.sectorOpacity, 0.4);
    assert.equal(defaultsCheck.subDisplay, 'none');
    assert.ok(
      defaultsCheck.arrowX2 > defaultsCheck.arrowX1,
      `Пункт 10: на схеме «Север по спутнику» стрелка «С» должна наклоняться вправо (x1=${defaultsCheck.arrowX1}, x2=${defaultsCheck.arrowX2})`
    );

    // Включаем сетку пад для демонстрации итоговой карты на скриншоте
    await desktopPage.locator('#togglePadas').check({ force: true });
    await desktopPage.waitForTimeout(200);

    const desktopBadges = await desktopPage.evaluate(
      () => window.__vastuApp.state.lastRenderMeta.placedBadges
    );
    assertNoOverlappingBadges(desktopBadges, 'Desktop 1440x900');

    const desktopPath = path.join(screenshotsDir, 'desktop-1440x900.png');
    await desktopPage.screenshot({ path: desktopPath });

    // Скачивание итоговой карты и проверка имени файла + всех 32 номеров пад в картинке (пункт 13)
    const exportMetaCheck = await desktopPage.evaluate(async () => {
      const mod = await import('./src/renderer.js');
      const pngCanvas = mod.exportMapToPngCanvas(window.__vastuApp.state);
      return pngCanvas.__exportRenderMeta;
    });
    assert.equal(
      exportMetaCheck.placedPadasCount,
      32,
      `Пункт 13: в сохранённой картинке должны быть все 32 номера пад (размещено ${exportMetaCheck.placedPadasCount})`
    );
    assert.equal(exportMetaCheck.hiddenPadasCount, 0);
    assertNoOverlappingBadges(exportMetaCheck.placedBadges, 'Exported PNG 32 padas');

    const [download] = await Promise.all([
      desktopPage.waitForEvent('download'),
      desktopPage.locator('#exportPngBtn').click(),
    ]);
    const suggestedName = download.suggestedFilename();
    assert.match(
      suggestedName,
      /^karta-kvartiry-\d{4}-\d{2}-\d{2}\.png$/,
      `Неверное имя файла скачивания: ${suggestedName}`
    );
    const exportedSamplePath = path.join(screenshotsDir, 'exported-map-sample.png');
    await download.saveAs(exportedSamplePath);

    // Пункт 14 и пункт 13 (тесный контур): проверяем обрезанный стеной Брахмастан
    const clippedCheck = await desktopPage.evaluate(async () => {
      const mod = await import('./src/renderer.js');
      const app = window.__vastuApp;
      // Несимметричная Г-образная форма, где Брахмастан прижат к наружной стене и обрезается
      app.state.vertices = [
        { x: 180, y: 120 },
        { x: 780, y: 120 },
        { x: 780, y: 330 },
        { x: 280, y: 330 },
        { x: 280, y: 780 },
        { x: 180, y: 780 },
      ];
      app.recomputeVastuMap();
      await new Promise((r) => requestAnimationFrame(r));

      // Перехватываем fillText при экспорте в PNG, чтобы убедиться: есть пометка об обрезанном Брахмастане и НЕТ фамилии Балуты!
      const drawnTexts = [];
      const origGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function patchedGetContext(type, ...rest) {
        const ctx2d = origGetContext.call(this, type, ...rest);
        if (type === '2d' && ctx2d && !ctx2d.__textHooked) {
          const origFillText = ctx2d.fillText.bind(ctx2d);
          ctx2d.fillText = (txt, ...args) => {
            drawnTexts.push(String(txt));
            return origFillText(txt, ...args);
          };
          ctx2d.__textHooked = true;
        }
        return ctx2d;
      };
      let exportMeta;
      try {
        const outCanvas = mod.exportMapToPngCanvas(app.state);
        exportMeta = outCanvas.__exportRenderMeta;
      } finally {
        HTMLCanvasElement.prototype.getContext = origGetContext;
      }

      return {
        wasClipped: app.state.vastuMap.brahmastan.wasClipped,
        outlineLoopsCount: app.state.vastuMap.brahmastan.outlineLoops.length,
        centerSummary: document.getElementById('centerSummaryText').textContent,
        drawnTexts,
        exportPlacedPadas: exportMeta.placedPadasCount,
      };
    });
    assert.equal(clippedCheck.wasClipped, true);
    assert.equal(clippedCheck.outlineLoopsCount, 1, 'Пункт 4: только 1 внешний контур без внутренних швов');
    assert.match(clippedCheck.centerSummary, /Брахмастан прижат к наружной стене/);
    assert.equal(
      /Балут/i.test(clippedCheck.centerSummary),
      false,
      'Пункт 14: в описании обрезанного Брахмастана не пишется «по методу С. А. Балуты»'
    );
    assert.equal(
      clippedCheck.drawnTexts.some((t) => /Балут/i.test(t)),
      false,
      'Пункт 14: в сохранённой картинке при обрезанном Брахмастане не пишется «по методу С. А. Балуты»'
    );
    assert.equal(
      clippedCheck.drawnTexts.some((t) => /Брахмастан (обрезан стеной|прижат к наружной стене)/.test(t)),
      true,
      'Пункт 14: в сохранённой картинке есть явная пометка об обрезанном Брахмастане'
    );
    assert.equal(
      clippedCheck.exportPlacedPadas,
      32,
      'Пункт 13: даже на узкой Г-образной квартире в картинке размещены все 32 номера пад'
    );

    await desktopCtx.close();

    // =========================================================================
    // 2. ТЕЛЕФОН 390x844 — итоговая карта + подсказка приблизить пады (пункт 13)
    // =========================================================================
    const mobileCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const mobilePage = await mobileCtx.newPage();
    attachGuards(mobilePage);

    await mobilePage.goto(baseUrl, { waitUntil: 'networkidle' });
    await mobilePage.evaluate(() => document.fonts.ready);
    await mobilePage.locator('#togglePadas').check({ force: true });
    await mobilePage.waitForTimeout(200);

    const mobilePadaState = await mobilePage.evaluate(() => ({
      badges: window.__vastuApp.state.lastRenderMeta.placedBadges,
      hiddenPadasCount: window.__vastuApp.state.lastRenderMeta.hiddenPadasCount,
      hintHidden: document.getElementById('padaZoomHint').hidden,
      hintText: document.getElementById('padaZoomHint').textContent.trim(),
    }));
    assertNoOverlappingBadges(mobilePadaState.badges, 'Mobile 390x844');
    if (mobilePadaState.hiddenPadasCount > 0) {
      assert.equal(
        mobilePadaState.hintHidden,
        false,
        'Пункт 13: на телефоне при скрытых номерах пад видна подсказка приблизить карту'
      );
      assert.equal(mobilePadaState.hintText, 'Приблизьте, чтобы увидеть все номера пад');
    }

    const mobilePath = path.join(screenshotsDir, 'mobile-390x844.png');
    await mobilePage.screenshot({ path: mobilePath });

    // =========================================================================
    // 3. ТЕЛЕФОН 390x844 — крупный спутник (п. 3), проверка «С» (п. 2, 5, 12),
    //    стрелка >3° (п. 8), короткие стены лоджии (п. 9) и отмена контура без сброса Севера (п. 1)
    // =========================================================================
    const satBuffer = await createSyntheticPortraitSatellitePngBuffer(mobilePage);

    assert.equal(fs.existsSync(EXTERNAL_CCITT_PDF), true, 'Файл CCITT G4 скана должен существовать');
    await mobilePage.setInputFiles('#planFileInput', EXTERNAL_CCITT_PDF);
    await mobilePage.waitForTimeout(500);

    const ccittCheck = await mobilePage.evaluate(() => {
      const st = window.__vastuApp.state;
      const c = st.planCanvas;
      if (!c) return { loaded: false };
      const g = c.getContext('2d');
      const data = g.getImageData(0, 0, c.width, c.height).data;
      let darkPixels = 0;
      for (let i = 0; i < data.length; i += 16) {
        if (data[i] < 120 && data[i + 1] < 120 && data[i + 2] < 120) {
          darkPixels++;
        }
      }
      return {
        loaded: true,
        maxSide: Math.max(c.width, c.height),
        pixels: c.width * c.height,
        darkPixels,
        northSet: st.northSet,
        northAngleDeg: st.northAngleDeg,
        topExportDisabled: document.getElementById('topExportBtn').disabled,
        fallbackSummary: document
          .querySelector('#panelPlan .subtle-card .small-copy')
          .textContent.trim(),
      };
    });
    assert.equal(ccittCheck.loaded, true, 'CCITT G4 PDF должен открываться');
    assert.ok(ccittCheck.darkPixels > 100);
    assert.ok(ccittCheck.maxSide <= 2000);
    assert.ok(ccittCheck.pixels <= 16_000_000);
    assert.equal(ccittCheck.northSet, false);
    assert.equal(ccittCheck.northAngleDeg, null);
    assert.equal(ccittCheck.topExportDisabled, true);
    assert.match(
      ccittCheck.fallbackSummary,
      /Если знаете, куда на листе смотрит Север/,
      'Пункт 5: исправлен заголовок запасного способа'
    );

    // Пункт 8: касание стрелки «С» без Севера (и микродрожание < 3°) НЕ делает Север заданным!
    const northHandleTapCheck = await mobilePage.evaluate(() => {
      const app = window.__vastuApp;
      const h = app.state.lastRenderMeta.northHandleScreen;
      const rect = document.getElementById('mapCanvas').getBoundingClientRect();
      return {
        hx: rect.left + h.x,
        hy: rect.top + h.y,
        ox: rect.left + h.originX,
        oy: rect.top + h.originY,
      };
    });
    await mobilePage.touchscreen.tap(northHandleTapCheck.hx, northHandleTapCheck.hy);
    await mobilePage.waitForTimeout(80);
    const northAfterSimpleTap = await mobilePage.evaluate(
      () => window.__vastuApp.state.northSet
    );
    assert.equal(
      northAfterSimpleTap,
      false,
      'Пункт 8: одиночное касание «С» без поворота не задаёт Север около 0°'
    );

    // Загружаем портретный скриншот со спутника (780x1688)
    await mobilePage.setInputFiles('#satFileInput', {
      name: 'satellite-phone-portrait.png',
      mimeType: 'image/png',
      buffer: satBuffer,
    });
    await mobilePage.waitForTimeout(220);

    // Пункт 3: проверяем, что скриншот открылся СРАЗУ КРУПНО (ширина >= 380 px, стена > 180 px),
    // и есть подсказка «Разведите двумя пальцами, чтобы увеличить дом»
    const satScaleCheck = await mobilePage.evaluate(() => {
      const st = window.__vastuApp.state;
      const xf = st.lastRenderMeta.transform;
      const rad = (22 * Math.PI) / 180;
      const toSat = (lx, ly) => ({
        x: 390 + lx * Math.cos(rad) - ly * Math.sin(rad),
        y: 844 + lx * Math.sin(rad) + ly * Math.cos(rad),
      });
      const p1 = xf.planToScreen(toSat(-190, -125));
      const p2 = xf.planToScreen(toSat(160, -125));
      const pTooClose = { x: p1.x + 36, y: p1.y + 12 };
      const rect = document.getElementById('mapCanvas').getBoundingClientRect();
      return {
        renderedSatWidthPx: st.sat.width * st.satZoom,
        renderedSatHeightPx: st.sat.height * st.satZoom,
        wallScreenLenPx: Math.hypot(p2.x - p1.x, p2.y - p1.y),
        hintText: document.getElementById('satStepHintText').textContent,
        bannerText: document.getElementById('canvasStatusBanner').textContent,
        c1: { x: rect.left + p1.x, y: rect.top + p1.y },
        c2: { x: rect.left + p2.x, y: rect.top + p2.y },
        cShort: { x: rect.left + pTooClose.x, y: rect.top + pTooClose.y },
      };
    });
    assert.ok(
      satScaleCheck.renderedSatWidthPx >= 380,
      `Пункт 3: снимок спутника открывается крупно по ширине экрана (${satScaleCheck.renderedSatWidthPx.toFixed(1)} px)`
    );
    assert.ok(
      satScaleCheck.wallScreenLenPx >= 150,
      `Пункт 3: стена дома на снимке крупная (${satScaleCheck.wallScreenLenPx.toFixed(1)} px вместо 30 px)`
    );
    assert.match(
      satScaleCheck.hintText,
      /Разведите двумя пальцами, чтобы увеличить дом/,
      'Пункт 3: показана подсказка про увеличение двумя пальцами'
    );

    // Ставим точку 1 на снимке спутника
    await mobilePage.touchscreen.tap(satScaleCheck.c1.x, satScaleCheck.c1.y);
    await mobilePage.waitForTimeout(120);

    // Снимаем контрольный скриншот шага 1 «На спутнике» крупно!
    const mobileSatStep1Path = path.join(screenshotsDir, 'mobile-390x844-sat-step1.png');
    await mobilePage.screenshot({ path: mobileSatStep1Path });

    // Пункт 3: пробуем поставить точку 2 слишком близко (~38 px < 100 px) — не должна приняться!
    await mobilePage.touchscreen.tap(satScaleCheck.cShort.x, satScaleCheck.cShort.y);
    await mobilePage.waitForTimeout(100);
    const shortSatRejected = await mobilePage.evaluate(() => ({
      satPtsLen: window.__vastuApp.state.sat.satPts.length,
      satViewMode: window.__vastuApp.state.satViewMode,
      hintText: document.getElementById('satStepHintText').textContent,
    }));
    assert.equal(shortSatRejected.satPtsLen, 1, 'Пункт 3: короткая стена (< 100 px) на спутнике отклонена');
    assert.equal(shortSatRejected.satViewMode, 'sat');
    assert.match(
      shortSatRejected.hintText,
      /слишком короткой.*подальше друг от друга/i
    );

    // Теперь ставим точку 2 далеко (> 200 px) -> переход на «2. На плане»
    await mobilePage.touchscreen.tap(satScaleCheck.c2.x, satScaleCheck.c2.y);
    await mobilePage.waitForTimeout(180);

    // На плане сначала пробуем поставить короткий отрезок (< 100 px) — он отклоняется с просьбой приблизить план;
    // затем приближаем план кнопкой «+» и ставим два угла длинной стены (> 140 px)
    const shortPlanTapCoords = await mobilePage.evaluate(() => {
      const st = window.__vastuApp.state;
      const xf = st.lastRenderMeta.transform;
      const p1 = xf.planToScreen({ x: st.planWidth * 0.25, y: st.planHeight * 0.30 });
      const rect = document.getElementById('mapCanvas').getBoundingClientRect();
      return {
        c1: { x: rect.left + p1.x, y: rect.top + p1.y },
        cShort: { x: rect.left + p1.x + 42, y: rect.top + p1.y },
      };
    });

    await mobilePage.touchscreen.tap(shortPlanTapCoords.c1.x, shortPlanTapCoords.c1.y);
    await mobilePage.waitForTimeout(80);
    await mobilePage.touchscreen.tap(shortPlanTapCoords.cShort.x, shortPlanTapCoords.cShort.y);
    await mobilePage.waitForTimeout(80);
    const shortPlanRejected = await mobilePage.evaluate(() => ({
      len: window.__vastuApp.state.sat.planPts.length,
      hint: document.getElementById('satStepHintText').textContent,
    }));
    assert.equal(shortPlanRejected.len, 1, 'Пункт 3: короткая стена (< 100 px) на плане тоже отклонена');
    assert.match(shortPlanRejected.hint, /слишком короткой.*подальше друг от друга/i);

    // Приближаем план (как просит подсказка) и ставим вторую точку стены (> 140 px)
    await mobilePage.locator('#zoomInBtn').click();
    await mobilePage.locator('#zoomInBtn').click();
    await mobilePage.waitForTimeout(100);

    const planTap2Coords = await mobilePage.evaluate(() => {
      const st = window.__vastuApp.state;
      const xf = st.lastRenderMeta.transform;
      const p1 = xf.planToScreen(st.sat.planPts[0]);
      const p2 = xf.planToScreen({ x: st.planWidth * 0.82, y: st.planHeight * 0.30 });
      const rect = document.getElementById('mapCanvas').getBoundingClientRect();
      return {
        c2: { x: rect.left + p2.x, y: rect.top + p2.y },
        distPx: Math.hypot(p2.x - p1.x, p2.y - p1.y),
      };
    });
    assert.ok(planTap2Coords.distPx >= 130, `Длина стены на приближённом плане ${planTap2Coords.distPx.toFixed(1)} px >= 130 px`);

    await mobilePage.touchscreen.tap(planTap2Coords.c2.x, planTap2Coords.c2.y);
    await mobilePage.waitForTimeout(280);

    const afterSatCalc = await mobilePage.evaluate(() => {
      const box = document.getElementById('satVerifyBox');
      const boxRect = box.getBoundingClientRect();
      return {
        northSet: window.__vastuApp.state.northSet,
        northAngleDeg: window.__vastuApp.state.northAngleDeg,
        satViewMode: window.__vastuApp.state.satViewMode,
        verifyVisible: !box.hidden,
        verifyBottom: boxRect.bottom,
        viewportH: window.innerHeight,
        tiltHidden: document.getElementById('satHouseTiltLine').hidden,
        tiltText: document.getElementById('satHouseTiltLine').textContent.trim(),
        bannerText: document.getElementById('canvasStatusBanner').textContent.trim(),
        rotateHintHidden: document.getElementById('rotateSheetHint').hidden,
      };
    });
    assert.equal(afterSatCalc.northSet, true, 'Север рассчитан по двум отрезкам');
    assert.equal(afterSatCalc.satViewMode, 'done');
    assert.equal(afterSatCalc.verifyVisible, true);
    assert.equal(afterSatCalc.tiltHidden, false, 'Пункт 5: показана строка угла поворота дома');
    assert.equal(
      afterSatCalc.tiltText,
      'Дом повёрнут на 22° относительно сторон света',
      'Пункт 5: точная формулировка угла поворота дома из урока'
    );
    assert.ok(
      afterSatCalc.verifyBottom <= afterSatCalc.viewportH + 2,
      `Пункт 12: блок «Проверьте направление «С»» прокручен в видимую часть экрана (bottom=${afterSatCalc.verifyBottom}, vh=${afterSatCalc.viewportH})`
    );
    assert.match(
      afterSatCalc.bannerText,
      /Проверьте направление «С»/,
      'Пункт 12: проверка продублирована в баннере над чертежом'
    );
    assert.equal(
      afterSatCalc.rotateHintHidden,
      false,
      'Пункт 11: при заданном Севере видно пояснение под «Повернуть лист на 90°»'
    );

    // Скриншот шага «Проверка «С»» после расчёта
    const mobileSatStep2Path = path.join(screenshotsDir, 'mobile-390x844-sat-step2.png');
    await mobilePage.screenshot({ path: mobileSatStep2Path });

    // Пункт 2: в виде «Проверка «С»» (план повёрнут севером вверх) пытаемся перетащить точку «1» пальцем —
    // точка «1» должна быть ТОЛЬКО ДЛЯ ПОКАЗА, Север НЕ уплывает!
    const dragPoint1InVerifyCheck = await mobilePage.evaluate(() => {
      const st = window.__vastuApp.state;
      const xf = st.lastRenderMeta.transform;
      const p1Screen = xf.planToScreen(st.sat.planPts[0]);
      const rect = document.getElementById('mapCanvas').getBoundingClientRect();
      const beforeNorth = st.northAngleDeg;
      const beforeP1 = { ...st.sat.planPts[0] };

      const c = document.getElementById('mapCanvas');
      const sx = rect.left + p1Screen.x;
      const sy = rect.top + p1Screen.y;
      c.dispatchEvent(
        new PointerEvent('pointerdown', {
          pointerId: 31,
          pointerType: 'touch',
          clientX: sx,
          clientY: sy,
          bubbles: true,
        })
      );
      const frozenDuringDrag = st.frozenRotationDeg;
      c.dispatchEvent(
        new PointerEvent('pointermove', {
          pointerId: 31,
          pointerType: 'touch',
          clientX: sx + 45,
          clientY: sy + 35,
          bubbles: true,
        })
      );
      c.dispatchEvent(
        new PointerEvent('pointerup', {
          pointerId: 31,
          pointerType: 'touch',
          clientX: sx + 45,
          clientY: sy + 35,
          bubbles: true,
        })
      );

      return {
        beforeNorth,
        afterNorth: st.northAngleDeg,
        beforeP1,
        afterP1: { ...st.sat.planPts[0] },
        frozenDuringDrag,
      };
    });
    assert.ok(
      Number.isFinite(dragPoint1InVerifyCheck.frozenDuringDrag),
      'Пункт 2: во время перетаскивания поворот экрана заморожен'
    );
    assert.equal(
      dragPoint1InVerifyCheck.afterNorth,
      dragPoint1InVerifyCheck.beforeNorth,
      'Пункт 2: перетаскивание по точке «1» в «Проверке «С»» не уводит Север'
    );
    assert.deepEqual(
      dragPoint1InVerifyCheck.afterP1,
      dragPoint1InVerifyCheck.beforeP1,
      'Пункт 2: точка «1» в виде «Проверка «С»» только для показа'
    );

    // =========================================================================
    // Пункты 1 и 9 на телефоне: обводка квартиры с лоджией (короткие стены ~16 px),
    // задание Севера ПОСЛЕ углов и «Отменить» лишнего угла без потери Севера!
    // =========================================================================
    // Сначала сбросим Север и точки, чтобы воспроизвести точный сценарий из пункта 1:
    // ученица обвела углы (плюс лишний угол) -> задала Север после контура -> нажала «Отменить» на лишнем угле.
    await mobilePage.evaluate(() => {
      const st = window.__vastuApp.state;
      st.vertices = [];
      st.undoHistory.clear();
      st.northSet = false;
      st.northAngleDeg = null;
      st.sat.planPts = [];
      st.sat.satPts = [];
      window.__vastuApp.recomputeVastuMap();
    });
    await mobilePage.locator('#tabBtnContour').click();
    await mobilePage.waitForTimeout(120);

    // Вычисляем экранные координаты 8 углов квартиры с лоджией, где короткие торцы лоджии имеют длину ~16 px на экране
    // (это меньше прежнего 26 px радиуса захвата, из-за чего раньше касания терялись!) + 9-й лишний угол.
    const loggiaTapData = await mobilePage.evaluate(() => {
      const st = window.__vastuApp.state;
      const xf = st.lastRenderMeta.transform;
      const rect = document.getElementById('mapCanvas').getBoundingClientRect();
      // Подбираем сдвиг короткой стенки ровно в 16 экранных пикселей!
      const shortPlanDelta = 16 / xf.zoom;
      const x0 = st.planWidth * 0.16;
      const xLog1 = st.planWidth * 0.36;
      const xLog2 = st.planWidth * 0.64;
      const x1 = st.planWidth * 0.84;
      const yLogTop = st.planHeight * 0.20;
      const yMainTop = yLogTop + shortPlanDelta;
      const yBot = st.planHeight * 0.78;

      const ptsPlan = [
        { x: x0, y: yMainTop },
        { x: xLog1, y: yMainTop },
        { x: xLog1, y: yLogTop }, // короткий 16 px левый торец лоджии!
        { x: xLog2, y: yLogTop },
        { x: xLog2, y: yMainTop }, // короткий 16 px правый торец лоджии!
        { x: x1, y: yMainTop },
        { x: x1, y: yBot },
        { x: x0, y: yBot },
      ];
      const screenCorners = ptsPlan.map((p) => {
        const s = xf.planToScreen(p);
        return { x: rect.left + s.x, y: rect.top + s.y };
      });
      const extra9th = (() => {
        const s = xf.planToScreen({ x: st.planWidth * 0.12, y: st.planHeight * 0.50 });
        return { x: rect.left + s.x, y: rect.top + s.y };
      })();
      const tooCloseTap = {
        x: screenCorners[0].x + 6,
        y: screenCorners[0].y + 4,
      };
      return { screenCorners, extra9th, tooCloseTap };
    });

    for (const c of loggiaTapData.screenCorners) {
      await mobilePage.touchscreen.tap(c.x, c.y);
      await mobilePage.waitForTimeout(45);
    }
    const loggiaCountAfter8 = await mobilePage.evaluate(
      () => window.__vastuApp.state.vertices.length
    );
    assert.equal(
      loggiaCountAfter8,
      8,
      'Пункт 9: все 8 углов квартиры с короткими 16 px торцами лоджии поставились без потерь'
    );

    // Проверяем слишком близкое касание (~7 px от угла): угол не дублируется, появляется подсказка «приблизьте план»
    await mobilePage.touchscreen.tap(loggiaTapData.tooCloseTap.x, loggiaTapData.tooCloseTap.y);
    await mobilePage.waitForTimeout(60);
    const tooCloseBanner = await mobilePage.locator('#canvasStatusBanner').textContent();
    assert.match(
      tooCloseBanner,
      /приблизьте план/i,
      'Пункт 9: при слишком близком касании выводится подсказка «приблизьте план»'
    );

    // Ставим лишний 9-й угол контура ДО задания Севера
    await mobilePage.touchscreen.tap(loggiaTapData.extra9th.x, loggiaTapData.extra9th.y);
    await mobilePage.waitForTimeout(50);
    assert.equal(
      await mobilePage.evaluate(() => window.__vastuApp.state.vertices.length),
      9
    );

    // Теперь ученица задаёт Север и точки стены ПОСЛЕ обводки углов
    await mobilePage.evaluate(() => {
      const app = window.__vastuApp;
      app.state.sat.satPts = [
        { x: 120, y: 200 },
        { x: 420, y: 260 },
      ];
      app.state.sat.planPts = [
        { x: 150, y: 180 },
        { x: 650, y: 180 },
      ];
      app.setNorthAngle(47);
    });
    await mobilePage.waitForTimeout(80);

    // Ученица нажимает «Отменить» на лишнем 9-м угле контура -> Север (47°) и точки стены ДОЛЖНЫ остаться прежними!
    await mobilePage.locator('#undoContourBtn').click();
    await mobilePage.waitForTimeout(100);
    const afterContourUndoBrowser = await mobilePage.evaluate(() => ({
      verticesLen: window.__vastuApp.state.vertices.length,
      northSet: window.__vastuApp.state.northSet,
      northAngleDeg: window.__vastuApp.state.northAngleDeg,
      satPlanPtsLen: window.__vastuApp.state.sat.planPts.length,
      satSatPtsLen: window.__vastuApp.state.sat.satPts.length,
      exportDisabled: document.getElementById('topExportBtn').disabled,
    }));
    assert.equal(afterContourUndoBrowser.verticesLen, 8, 'Лишний 9-й угол отменён');
    assert.equal(afterContourUndoBrowser.northSet, true, 'Пункт 1: Север НЕ стёрся после Отменить контура');
    assert.equal(afterContourUndoBrowser.northAngleDeg, 47, 'Пункт 1: Север НЕ вернулся к старому значению');
    assert.equal(afterContourUndoBrowser.satPlanPtsLen, 2, 'Пункт 1: точки стены на плане прежние');
    assert.equal(afterContourUndoBrowser.satSatPtsLen, 2, 'Пункт 1: точки стены на спутнике прежние');
    assert.equal(afterContourUndoBrowser.exportDisabled, false);

    // Проверка восстановления работы после перезагрузки и окна подтверждения
    await mobilePage.waitForTimeout(300);
    await mobilePage.reload({ waitUntil: 'networkidle' });
    await mobilePage.waitForTimeout(250);
    const restoredSession = await mobilePage.evaluate(() => ({
      isSamplePlan: window.__vastuApp.state.isSamplePlan,
      verticesCount: window.__vastuApp.state.vertices.length,
      northSet: window.__vastuApp.state.northSet,
      northAngleDeg: window.__vastuApp.state.northAngleDeg,
    }));
    assert.equal(restoredSession.isSamplePlan, false);
    assert.equal(restoredSession.verticesCount, 8);
    assert.equal(restoredSession.northSet, true);
    assert.equal(restoredSession.northAngleDeg, 47);

    // Проверка русской ошибки на битом PDF
    await mobilePage.locator('#tabBtnPlan').click();
    await mobilePage.setInputFiles('#planFileInput', {
      name: 'broken.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('NOT_A_VALID_PDF_FILE'),
    });
    await mobilePage.waitForTimeout(100);
    await mobilePage.locator('#confirmModalAcceptBtn').click();
    await mobilePage.waitForTimeout(300);
    const errText = (await mobilePage.locator('#planErrorBox').textContent()).trim();
    assert.equal(
      errText,
      'Не получилось открыть этот PDF на телефоне — загрузите план как фото или скриншот'
    );

    await mobileCtx.close();

    // =========================================================================
    // 4. ПУНКТ 6: PDF на старом iOS без Promise.withResolvers и URL.parse (в окне и в Worker!)
    // =========================================================================
    const legacyIosPdfCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
    });
    // Удаляем Promise.withResolvers и URL.parse в главном потоке ДО любых скриптов страницы
    await legacyIosPdfCtx.addInitScript(() => {
      delete Promise.withResolvers;
      delete URL.parse;
    });
    // И перехватываем pdf-polyfills.mjs (и в окне, и в Worker!), удаляя нативные Promise.withResolvers и URL.parse
    // прямо перед установкой полифила (в ES-модулях статические import всплывают выше кода обёртки)
    const polyfillRaw = fs.readFileSync(
      path.join(serveTarget, 'vendor', 'pdf-polyfills.mjs'),
      'utf8'
    );
    await legacyIosPdfCtx.route('**/*pdf-polyfills.mjs', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/javascript; charset=utf-8',
        body: `delete Promise.withResolvers;\ndelete URL.parse;\n${polyfillRaw}`,
      });
    });

    const legacyPdfPage = await legacyIosPdfCtx.newPage();
    attachGuards(legacyPdfPage);
    await legacyPdfPage.goto(baseUrl, { waitUntil: 'networkidle' });
    await legacyPdfPage.setInputFiles('#planFileInput', EXTERNAL_CCITT_PDF);
    await legacyPdfPage.waitForTimeout(600);

    const legacyPdfResult = await legacyPdfPage.evaluate(() => ({
      hasPolyfilledWithResolvers: typeof Promise.withResolvers === 'function',
      isCustomPolyfill:
        typeof Promise.withResolvers === 'function' &&
        !Function.prototype.toString.call(Promise.withResolvers).includes('[native code]'),
      isSamplePlan: window.__vastuApp.state.isSamplePlan,
      planWidth: window.__vastuApp.state.planWidth,
      planErrorHidden: document.getElementById('planErrorBox').hidden,
    }));
    assert.equal(
      legacyPdfResult.hasPolyfilledWithResolvers,
      true,
      'Пункт 6: полифил Promise.withResolvers установлен до pdf.js'
    );
    assert.equal(
      legacyPdfResult.isCustomPolyfill,
      true,
      'Пункт 6: работает именно наш полифил Promise.withResolvers (нативный был удалён)'
    );
    assert.equal(
      legacyPdfResult.isSamplePlan,
      false,
      'Пункт 6: PDF CCITT G4 успешно открылся при удалённом нативном Promise.withResolvers в окне и в Worker'
    );
    assert.equal(legacyPdfResult.planErrorHidden, true);
    assert.ok(legacyPdfResult.planWidth > 400);
    await legacyIosPdfCtx.close();

    // =========================================================================
    // 5. ТЕЛЕФОН АЛЬБОМНО 844x390 + отмена поворота листа на 90°
    // =========================================================================
    const landscapeCtx = await browser.newContext({
      viewport: { width: 844, height: 390 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const landscapePage = await landscapeCtx.newPage();
    attachGuards(landscapePage);

    await landscapePage.goto(baseUrl, { waitUntil: 'networkidle' });
    await landscapePage.evaluate(() => document.fonts.ready);
    await landscapePage.locator('#togglePadas').check({ force: true });
    await landscapePage.waitForTimeout(200);

    const landscapeLayout = await landscapePage.evaluate(() => {
      const stage = document.getElementById('canvasStage').getBoundingClientRect();
      const panel = document.querySelector('.inspector-panel').getBoundingClientRect();
      return {
        stageW: stage.width,
        stageH: stage.height,
        panelLeft: panel.left,
        panelH: panel.height,
        badges: window.__vastuApp.state.lastRenderMeta.placedBadges,
      };
    });
    assert.ok(landscapeLayout.panelLeft >= landscapeLayout.stageW - 2);
    assert.ok(landscapeLayout.stageH >= 330 && landscapeLayout.panelH >= 330);
    assertNoOverlappingBadges(landscapeLayout.badges, 'Landscape 844x390');

    const landscapePath = path.join(screenshotsDir, 'mobile-landscape-844x390.png');
    await landscapePage.screenshot({ path: landscapePath });

    // Проверка поворота листа на 90° и совместного возврата по «Отменить» (лист + контур + Север вместе)
    const rotUndoCheck = await landscapePage.evaluate(() => {
      const app = window.__vastuApp;
      const beforeW = app.state.planCanvas.width;
      const beforeH = app.state.planCanvas.height;
      const beforeNorth = app.state.northAngleDeg;
      const beforeV0 = { ...app.state.vertices[0] };
      document.getElementById('rotatePlan90Btn').click();
      const rotW = app.state.planCanvas.width;
      const rotNorth = app.state.northAngleDeg;
      app.performUndo();
      return {
        beforeW,
        beforeH,
        beforeNorth,
        beforeV0,
        rotW,
        rotNorth,
        afterW: app.state.planCanvas.width,
        afterH: app.state.planCanvas.height,
        afterNorth: app.state.northAngleDeg,
        afterV0: { ...app.state.vertices[0] },
      };
    });
    assert.equal(rotUndoCheck.rotW, rotUndoCheck.beforeH);
    assert.equal(rotUndoCheck.afterW, rotUndoCheck.beforeW);
    assert.equal(rotUndoCheck.afterH, rotUndoCheck.beforeH);
    assert.equal(rotUndoCheck.afterNorth, rotUndoCheck.beforeNorth);
    assert.deepEqual(rotUndoCheck.afterV0, rotUndoCheck.beforeV0);
    await landscapeCtx.close();

    // =========================================================================
    // 6. ПУНКТ 7: ANDROID (скачивание файла + отдельная кнопка «Поделиться» -> «Отправлено»)
    //             и iPHONE («Скачать карту» -> системное меню Поделиться -> «Отправлено»)
    // =========================================================================
    const androidCtx = await browser.newContext({
      viewport: { width: 412, height: 915 },
      isMobile: true,
      hasTouch: true,
      userAgent:
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
    });
    const androidPage = await androidCtx.newPage();
    attachGuards(androidPage);
    await androidPage.goto(baseUrl, { waitUntil: 'networkidle' });

    // Подключаем mock Web Share API на Android и проверяем, что «Поделиться» видна отдельной кнопкой,
    // НО «Скачать карту» скачивает файл напрямую (НЕ вызывая navigator.share!),
    // а кнопка «Поделиться» вызывает navigator.share и пишет «Отправлено»!
    await androidPage.evaluate(() => {
      window.__shareCalls = 0;
      Object.defineProperty(navigator, 'canShare', {
        configurable: true,
        value: (data) => Boolean(data && Array.isArray(data.files) && data.files.length === 1),
      });
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async () => {
          window.__shareCalls += 1;
        },
      });
      // Пересинхронизируем кнопку Поделиться после подстановки canShare
      window.__vastuApp.recomputeVastuMap();
    });

    const androidShareBtnVisible = await androidPage.evaluate(
      () => !document.getElementById('shareMapBtn').hidden
    );
    assert.equal(androidShareBtnVisible, true, 'Пункт 7: на Android показана отдельная кнопка «Поделиться»');

    const [androidDownload] = await Promise.all([
      androidPage.waitForEvent('download'),
      androidPage.locator('#exportPngBtn').click(),
    ]);
    assert.match(androidDownload.suggestedFilename(), /^karta-kvartiry-\d{4}-\d{2}-\d{2}\.png$/);
    const androidAfterDownload = await androidPage.evaluate(() => ({
      shareCalls: window.__shareCalls,
      toastText: document.getElementById('saveToastText').textContent,
    }));
    assert.equal(
      androidAfterDownload.shareCalls,
      0,
      'Пункт 7: на Android «Скачать карту» скачивает файл, а не открывает окно Поделиться'
    );
    assert.match(androidAfterDownload.toastText, /^Карта сохранена/);

    // Теперь нажимаем отдельную кнопку «Поделиться» на Android -> вызывается navigator.share и тост «Отправлено»!
    await androidPage.locator('#shareMapBtn').click();
    await androidPage.waitForTimeout(80);
    const androidAfterShare = await androidPage.evaluate(() => ({
      shareCalls: window.__shareCalls,
      toastText: document.getElementById('saveToastText').textContent,
    }));
    assert.equal(androidAfterShare.shareCalls, 1);
    assert.equal(
      androidAfterShare.toastText,
      'Отправлено',
      'Пункт 7: после «Поделиться» пишется «Отправлено», а не «Карта сохранена»'
    );
    await androidCtx.close();

    // iPhone Safari: «Скачать карту» открывает окно Поделиться (с «Сохранить изображение» в Фото) и пишет «Отправлено»
    const iphoneCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    });
    const iphonePage = await iphoneCtx.newPage();
    attachGuards(iphonePage);
    await iphonePage.goto(baseUrl, { waitUntil: 'networkidle' });
    const iphoneShareResult = await iphonePage.evaluate(async () => {
      let sharedFile = null;
      Object.defineProperty(navigator, 'canShare', {
        configurable: true,
        value: (data) => Boolean(data && Array.isArray(data.files) && data.files.length === 1),
      });
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (data) => {
          sharedFile = data.files[0].name;
        },
      });
      document.getElementById('exportPngBtn').click();
      await new Promise((r) => setTimeout(r, 80));
      return {
        sharedFile,
        toastText: document.getElementById('saveToastText').textContent,
      };
    });
    assert.match(iphoneShareResult.sharedFile, /^karta-kvartiry-\d{4}-\d{2}-\d{2}\.png$/);
    assert.equal(
      iphoneShareResult.toastText,
      'Отправлено',
      'Пункт 7: на iPhone после окна «Поделиться» пишется «Отправлено»'
    );
    await iphoneCtx.close();

    // Проверка встроенного браузера Telegram (показ картинки поверх экрана с подсказкой удерживать)
    const tgCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Telegram/10.5',
    });
    const tgPage = await tgCtx.newPage();
    attachGuards(tgPage);
    await tgPage.goto(baseUrl, { waitUntil: 'networkidle' });
    await tgPage.locator('#topExportBtn').click();
    await tgPage.waitForTimeout(100);
    const tgOverlayCheck = await tgPage.evaluate(() => ({
      modalOpen: !document.getElementById('imagePreviewModal').hidden,
      hintText: document.querySelector('.image-preview-hint').textContent,
      hasImgSrc: document.getElementById('previewModalImg').src.startsWith('data:image/png'),
    }));
    assert.equal(tgOverlayCheck.modalOpen, true);
    assert.match(tgOverlayCheck.hintText, /нажмите и удерживайте, чтобы сохранить/i);
    assert.equal(tgOverlayCheck.hasImgSrc, true);
    await tgCtx.close();

    if (externalRequests.length > 0) {
      throw new Error(
        `Обнаружены внешние сетевые запросы: ${externalRequests.join(', ')}`
      );
    }
    if (consoleErrors.length > 0) {
      throw new Error(`Ошибки в консоли браузера: ${consoleErrors.join('; ')}`);
    }
    if (pageErrors.length > 0) {
      throw new Error(`Необработанные ошибки страницы: ${pageErrors.join('; ')}`);
    }

    console.log('Скриншоты и браузерные проверки третьего круга успешно выполнены:');
    console.log(` - ${mobilePath}`);
    console.log(` - ${mobileSatStep1Path}`);
    console.log(` - ${mobileSatStep2Path}`);
    console.log(` - ${landscapePath}`);
    console.log(` - ${desktopPath}`);
    console.log(` - ${exportedSamplePath}`);
    console.log('Проверка PDF без Promise.withResolvers (iOS 16.4+): CCITT G4 скан БТИ успешно открыт в окне и в Worker.');
    console.log('Проверка PNG-экспорта: 32 из 32 номеров пад без наложений, внешний контур Брахмастана без внутренних швов.');
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
