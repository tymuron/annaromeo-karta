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
 * Генерирует чистый PNG-буфер архитектурного плана Г-образной квартиры (1400x1060)
 * для реалистичной загрузки ученицей на Шаге 1.
 */
async function createSyntheticFloorPlanPngBuffer(page) {
  const result = await page.evaluate(async () => {
    const mod = await import('./src/sample-plan.js');
    const sample = mod.createSampleFloorPlan();
    return {
      dataUrl: sample.canvas.toDataURL('image/png'),
      defaultVertices: sample.defaultVertices,
      width: sample.width,
      height: sample.height,
    };
  });
  const b64 = result.dataUrl.split(',')[1];
  return {
    buffer: Buffer.from(b64, 'base64'),
    defaultVertices: result.defaultVertices,
    width: result.width,
    height: result.height,
  };
}

/**
 * Создаёт реалистичный портретный скриншот со спутника (780x1688, как на экране телефона 390x844 @2x):
 * Г-образная крыша дома повёрнута на −22° (против часовой стрелки), чтобы при горизонтальной верхней стене
 * на плане Север оказывался на +22° по часовой стрелке от верха листа.
 */
async function createSyntheticPortraitSatellitePngBuffer(page, roofRotDeg = -22) {
  const dataUrl = await page.evaluate((rotDeg) => {
    const c = document.createElement('canvas');
    c.width = 780;
    c.height = 1688;
    const g = c.getContext('2d');

    g.fillStyle = '#334139';
    g.fillRect(0, 0, c.width, c.height);

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

    g.save();
    g.translate(390, 844);
    g.rotate((rotDeg * Math.PI) / 180);

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

    g.strokeStyle = '#6B6963';
    g.lineWidth = 2;
    g.strokeRect(-172, -108, 314, 236);
    g.fillStyle = '#ABA79E';
    g.fillRect(-95, -55, 24, 16);
    g.fillRect(25, -55, 24, 16);
    g.fillRect(110, 45, 24, 16);
    g.restore();

    return c.toDataURL('image/png');
  }, roofRotDeg);

  const b64 = dataUrl.split(',')[1];
  return Buffer.from(b64, 'base64');
}

/**
 * Проходит полный путь ученицы (Шаг 1 -> Шаг 2 по спутнику -> Шаг 3 контур -> Шаг 4 карта)
 * через интерфейс для подготовки готовой карты.
 */
async function completeFullSatelliteFlowOnPage(page, planAsset, satBuffer, roofRotDeg = -22) {
  await page.setInputFiles('#planFileInput', {
    name: 'plan-kvartiry.png',
    mimeType: 'image/png',
    buffer: planAsset.buffer,
  });
  await page.waitForTimeout(160);

  await page.setInputFiles('#satFileInput', {
    name: 'satellite-home.png',
    mimeType: 'image/png',
    buffer: satBuffer,
  });
  await page.waitForTimeout(160);

  const satCoords = await page.evaluate((rotDeg) => {
    const st = window.__vastuApp.state;
    const xf = st.lastRenderMeta.transform;
    const rad = (rotDeg * Math.PI) / 180;
    const toSat = (lx, ly) => ({
      x: 390 + lx * Math.cos(rad) - ly * Math.sin(rad),
      y: 844 + lx * Math.sin(rad) + ly * Math.cos(rad),
    });
    const p1 = xf.planToScreen(toSat(-190, -125));
    const p2 = xf.planToScreen(toSat(160, -125));
    const rect = document.getElementById('mapCanvas').getBoundingClientRect();
    return {
      c1: { x: rect.left + p1.x, y: rect.top + p1.y },
      c2: { x: rect.left + p2.x, y: rect.top + p2.y },
    };
  }, roofRotDeg);

  await page.mouse.click(satCoords.c1.x, satCoords.c1.y);
  await page.waitForTimeout(50);
  await page.mouse.click(satCoords.c2.x, satCoords.c2.y);
  await page.waitForTimeout(50);
  await page.evaluate(() => window.__vastuApp.handlePointPickingDone());
  await page.waitForTimeout(100);

  const planWallCoords = await page.evaluate((verts) => {
    const st = window.__vastuApp.state;
    const xf = st.lastRenderMeta.transform;
    const p1 = xf.planToScreen(verts[0]);
    const p2 = xf.planToScreen(verts[1]);
    const rect = document.getElementById('mapCanvas').getBoundingClientRect();
    return {
      c1: { x: rect.left + p1.x, y: rect.top + p1.y },
      c2: { x: rect.left + p2.x, y: rect.top + p2.y },
    };
  }, planAsset.defaultVertices);

  await page.mouse.click(planWallCoords.c1.x, planWallCoords.c1.y);
  await page.waitForTimeout(50);
  await page.mouse.click(planWallCoords.c2.x, planWallCoords.c2.y);
  await page.waitForTimeout(50);
  await page.evaluate(() => window.__vastuApp.handlePointPickingDone());
  await page.waitForTimeout(120);

  await page.locator('#northNextContourBtn').click();
  await page.waitForTimeout(120);

  const contourScreenPts = await page.evaluate((verts) => {
    const st = window.__vastuApp.state;
    const xf = st.lastRenderMeta.transform;
    const rect = document.getElementById('mapCanvas').getBoundingClientRect();
    return verts.map((v) => {
      const s = xf.planToScreen(v);
      return { x: rect.left + s.x, y: rect.top + s.y };
    });
  }, planAsset.defaultVertices);

  for (const pt of contourScreenPts) {
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(35);
  }
  await page.evaluate(() => window.__vastuApp.handlePointPickingDone());
  await page.waitForTimeout(150);
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
  const savedScreenshots = [];

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

  async function takeShot(page, filename) {
    const full = path.join(screenshotsDir, filename);
    await page.screenshot({ path: full });
    savedScreenshots.push(full);
    return full;
  }

  try {
    // =========================================================================
    // 1. КОМПЬЮТЕР 1440x900: Шаг 1 без плана -> прохождение шагов 1..4 -> PNG экспорт
    // =========================================================================
    const desktopCtx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    const desktopPage = await desktopCtx.newPage();
    attachGuards(desktopPage);

    await desktopPage.goto(baseUrl, { waitUntil: 'networkidle' });
    await desktopPage.evaluate(() => document.fonts.ready);
    await desktopPage.waitForTimeout(140);

    // Проверяем начальное состояние на компьютере: Шаг 1 активен, шаги 2–4 недоступны, запасного способа нет
    const desktopStep1Check = await desktopPage.evaluate(() => {
      const steps = window.__vastuApp.computeStepsState();
      return {
        activeTab: steps.activeTab,
        hasPlan: steps.hasPlan,
        disabledFlags: steps.steps.map((s) => s.disabled),
        captions: steps.steps.map((s) => s.lockedCaption),
        hasFallbackText: /Запасной способ/i.test(document.body.innerHTML),
        hasNorthSlider: Boolean(document.getElementById('northSlider')),
        hasNorthNumberInput: Boolean(document.getElementById('northNumberInput')),
        topExportHidden: document.getElementById('topExportBtn').hidden,
      };
    });
    assert.equal(desktopStep1Check.activeTab, 'plan');
    assert.equal(desktopStep1Check.hasPlan, false);
    assert.deepEqual(desktopStep1Check.disabledFlags, [false, true, true, true]);
    assert.deepEqual(desktopStep1Check.captions, [
      '',
      'сначала шаг 1',
      'сначала шаг 1',
      'сначала шаг 1',
    ]);
    assert.equal(desktopStep1Check.hasFallbackText, false);
    assert.equal(desktopStep1Check.hasNorthSlider, false);
    assert.equal(desktopStep1Check.hasNorthNumberInput, false);
    assert.equal(desktopStep1Check.topExportHidden, true);

    await takeShot(desktopPage, 'desktop-1440x900-step1-no-plan.png');

    const planAsset = await createSyntheticFloorPlanPngBuffer(desktopPage);
    const satBufferNeg22 = await createSyntheticPortraitSatellitePngBuffer(desktopPage, -22);
    const satBufferPos22 = await createSyntheticPortraitSatellitePngBuffer(desktopPage, 22);

    await completeFullSatelliteFlowOnPage(desktopPage, planAsset, satBufferNeg22, -22);

    const defaultsCheck = await desktopPage.evaluate(() => {
      const app = window.__vastuApp;
      const steps = app.computeStepsState();
      const sub = document.getElementById('padaSuboptions');
      const toggleLabelsEl = document.getElementById('toggleSectorLabels');
      const schemeNorthLine = document.querySelector(
        '.sat-diagram svg line[stroke-dasharray]'
      );
      const meta = app.state.lastRenderMeta;
      return {
        stepTitles: steps.steps.map((s) => s.displayTitle),
        activeTab: steps.activeTab,
        northSource: app.state.northSource,
        northAngleDeg: app.state.northAngleDeg,
        alignNorthUp: app.state.alignNorthUp,
        showSectorLabels: app.state.layers.showSectorLabels,
        toggleLabelsChecked: toggleLabelsEl ? toggleLabelsEl.checked : null,
        showAxes: app.state.layers.showAxes,
        showPadas: app.state.layers.showPadas,
        sectorOpacity: app.state.layers.sectorOpacity,
        subDisplay: getComputedStyle(sub).display,
        arrowX1: Number(schemeNorthLine.getAttribute('x1')),
        arrowX2: Number(schemeNorthLine.getAttribute('x2')),
        placedAxesCount: meta.placedAxesCount,
        renderedAxes: meta.renderedAxes,
        badges: meta.placedBadges,
      };
    });
    assert.equal(defaultsCheck.activeTab, 'layers');
    assert.equal(defaultsCheck.northSource, 'satellite');
    assert.deepEqual(defaultsCheck.stepTitles.slice(0, 3), [
      '✓ 1. План',
      '✓ 2. Север',
      '✓ 3. Контур стен',
    ]);
    assert.equal(defaultsCheck.alignNorthUp, true);
    assert.equal(defaultsCheck.showSectorLabels, false);
    assert.equal(defaultsCheck.toggleLabelsChecked, false);
    assert.equal(defaultsCheck.showAxes, true);
    assert.equal(defaultsCheck.placedAxesCount, 8);
    assert.equal(defaultsCheck.badges.filter((b) => b.kind === 'sector').length, 0);
    const cardAxisW = defaultsCheck.renderedAxes.find((a) => a.isCardinal).lineWidth;
    const diagAxisW = defaultsCheck.renderedAxes.find((a) => !a.isCardinal).lineWidth;
    assert.ok(cardAxisW > diagAxisW);
    assertNoOverlappingBadges(defaultsCheck.badges, 'Desktop 1440x900 ready map');
    assert.equal(defaultsCheck.subDisplay, 'none');
    assert.ok(defaultsCheck.arrowX2 > defaultsCheck.arrowX1);

    await takeShot(desktopPage, 'desktop-1440x900.png');

    // Проверяем скачивание PNG и галочку на 4-м шаге («✓ 4. Карта»)
    const [downloadNoLabels] = await Promise.all([
      desktopPage.waitForEvent('download'),
      desktopPage.locator('#exportPngBtn').click(),
    ]);
    assert.match(downloadNoLabels.suggestedFilename(), /^karta-kvartiry-\d{4}-\d{2}-\d{2}\.png$/);
    const exportedSamplePath = path.join(screenshotsDir, 'exported-map-sample.png');
    await downloadNoLabels.saveAs(exportedSamplePath);
    savedScreenshots.push(exportedSamplePath);

    const step4TitleAfterExport = await desktopPage.evaluate(
      () => document.querySelector('#tabBtnLayers .mode-tab-title').textContent.trim()
    );
    assert.equal(step4TitleAfterExport, '✓ 4. Карта');

    // Проверяем переключатель «Подписи секторов» и сетку 32 пад в экспорте
    await desktopPage.locator('#toggleSectorLabels').check({ force: true });
    await desktopPage.waitForTimeout(140);
    const [downloadWithLabels] = await Promise.all([
      desktopPage.waitForEvent('download'),
      desktopPage.locator('#exportPngBtn').click(),
    ]);
    const exportedWithLabelsPath = path.join(screenshotsDir, 'exported-map-with-labels.png');
    await downloadWithLabels.saveAs(exportedWithLabelsPath);
    savedScreenshots.push(exportedWithLabelsPath);

    await desktopPage.locator('#toggleSectorLabels').uncheck({ force: true });
    await desktopPage.locator('#togglePadas').check({ force: true });
    await desktopPage.waitForTimeout(140);

    const exportMetaCheck = await desktopPage.evaluate(async () => {
      const mod = await import('./src/renderer.js');
      const pngCanvas = mod.exportMapToPngCanvas(window.__vastuApp.state);
      return pngCanvas.__exportRenderMeta;
    });
    assert.equal(exportMetaCheck.placedPadasCount, 32);
    assert.equal(exportMetaCheck.placedAxesCount, 8);
    assertNoOverlappingBadges(exportMetaCheck.placedBadges, 'Exported PNG 32 padas + 8 axes');

    await desktopCtx.close();

    // =========================================================================
    // 2. ТЕЛЕФОН 390x844 (iPhone):
    //    - Шаг 1 без плана (шаги 2–4 недоступны, одна крупная кнопка)
    //    - Шаг 2 со спутником (крупное поле >= 75% высоты, 1 строка с Отменить / Готово)
    //    - Шаг 2 отметка точек на плане (крупное поле >= 75% высоты, 1 строка с Отменить / Готово)
    //    - Шаг 2 проверка «С» (без ручного вращения стрелки «С»)
    //    - Шаг 3 контур стен (крупное поле >= 75% высоты, 1 строка с Отменить / Готово, короткие стены лоджии)
    //    - Шаг 4 готовая карта
    // =========================================================================
    const mobile390Ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const mobile390Page = await mobile390Ctx.newPage();
    attachGuards(mobile390Page);

    await mobile390Page.goto(baseUrl, { waitUntil: 'networkidle' });
    await mobile390Page.evaluate(() => document.fonts.ready);
    await mobile390Page.waitForTimeout(150);

    // 2.1. Шаг 1 без плана на 390x844
    const m390Step1 = await mobile390Page.evaluate(() => {
      const heroBtn = document.getElementById('openPlanHeroBtn').getBoundingClientRect();
      const tabNorth = document.getElementById('tabBtnNorth');
      const tabContour = document.getElementById('tabBtnContour');
      const tabLayers = document.getElementById('tabBtnLayers');
      // Пытаемся программно переключить шаг без плана — должен остаться 'plan'
      window.__vastuApp.setActiveTab('north');
      window.__vastuApp.setActiveTab('contour');
      window.__vastuApp.setActiveTab('layers');
      return {
        activeAfterTries: window.__vastuApp.state.activeTab,
        northDisabled: tabNorth.disabled,
        contourDisabled: tabContour.disabled,
        layersDisabled: tabLayers.disabled,
        northText: tabNorth.textContent.replace(/\s+/g, ' ').trim(),
        heroVisibleInViewport: heroBtn.top >= 0 && heroBtn.bottom <= window.innerHeight,
        heroHeight: heroBtn.height,
        zoomControlsHidden: document.getElementById('canvasZoomControls').hidden,
        topExportHidden: document.getElementById('topExportBtn').hidden,
      };
    });
    assert.equal(m390Step1.activeAfterTries, 'plan', 'Без плана шаги 2–4 не открываются');
    assert.equal(m390Step1.northDisabled, true);
    assert.equal(m390Step1.contourDisabled, true);
    assert.equal(m390Step1.layersDisabled, true);
    assert.match(m390Step1.northText, /2\. Север.*сначала шаг 1/);
    assert.equal(m390Step1.heroVisibleInViewport, true);
    assert.ok(m390Step1.heroHeight >= 50, 'Крупная кнопка «Откройте план квартиры»');
    assert.equal(m390Step1.zoomControlsHidden, true);
    assert.equal(m390Step1.topExportHidden, true);

    await takeShot(mobile390Page, 'mobile-390x844-step1-no-plan.png');

    // Загружаем план квартиры -> автоматически открывается Шаг 2 («2. Север») с одной крупной кнопкой «Загрузить скриншот со спутника»
    await mobile390Page.setInputFiles('#planFileInput', {
      name: 'plan-kvartiry.png',
      mimeType: 'image/png',
      buffer: planAsset.buffer,
    });
    await mobile390Page.waitForTimeout(200);

    const m390AfterPlan = await mobile390Page.evaluate(() => ({
      activeTab: window.__vastuApp.state.activeTab,
      tab1Title: document.querySelector('#tabBtnPlan .mode-tab-title').textContent.trim(),
      tab2Active: document.getElementById('tabBtnNorth').classList.contains('is-active'),
      tab2Disabled: document.getElementById('tabBtnNorth').disabled,
      northHandleScreen: window.__vastuApp.state.lastRenderMeta.northHandleScreen,
      uploadVisible: !document.getElementById('northSubUpload').hidden,
    }));
    assert.equal(m390AfterPlan.activeTab, 'north', 'После загрузки плана сразу открывается Шаг 2 (Север)');
    assert.equal(m390AfterPlan.tab1Title, '✓ 1. План');
    assert.equal(m390AfterPlan.tab2Active, true);
    assert.equal(m390AfterPlan.tab2Disabled, false);
    assert.equal(m390AfterPlan.northHandleScreen, null, 'Ручной ручки поворота «С» нет');
    assert.equal(m390AfterPlan.uploadVisible, true);

    await takeShot(mobile390Page, 'mobile-390x844-step2-upload-sat.png');

    // 2.2. Загружаем портретный скриншот со спутника -> крупное поле (>= 75% экрана) + сжатая 1-строчная панель
    await mobile390Page.setInputFiles('#satFileInput', {
      name: 'satellite-phone-portrait.png',
      mimeType: 'image/png',
      buffer: satBufferPos22,
    });
    await mobile390Page.waitForTimeout(220);

    const m390SatScale = await mobile390Page.evaluate(() => {
      const st = window.__vastuApp.state;
      const stageRect = document.getElementById('canvasStage').getBoundingClientRect();
      const barRect = document.getElementById('mobilePickingBar').getBoundingClientRect();
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
        stageRatio: stageRect.height / window.innerHeight,
        barHeight: barRect.height,
        inspectorScrollDisplay: getComputedStyle(document.getElementById('inspectorScroll')).display,
        renderedSatWidthPx: st.sat.width * st.satZoom,
        wallScreenLenPx: Math.hypot(p2.x - p1.x, p2.y - p1.y),
        c1: { x: rect.left + p1.x, y: rect.top + p1.y },
        c2: { x: rect.left + p2.x, y: rect.top + p2.y },
        cShort: { x: rect.left + pTooClose.x, y: rect.top + pTooClose.y },
      };
    });
    assert.ok(
      m390SatScale.stageRatio >= 0.75,
      `390x844 спутник: высота поля ${(m390SatScale.stageRatio * 100).toFixed(1)}% >= 75%`
    );
    assert.ok(m390SatScale.barHeight <= 64, 'Панель сжата до одной строки');
    assert.equal(m390SatScale.inspectorScrollDisplay, 'none');
    assert.ok(m390SatScale.renderedSatWidthPx >= 380);
    assert.ok(m390SatScale.wallScreenLenPx >= 150);

    // Ставим точку 1, проверяем отклонение короткой стены (< 100px), затем ставим точку 2 и снимаем скриншот
    await mobile390Page.touchscreen.tap(m390SatScale.c1.x, m390SatScale.c1.y);
    await mobile390Page.waitForTimeout(80);
    await mobile390Page.touchscreen.tap(m390SatScale.cShort.x, m390SatScale.cShort.y);
    await mobile390Page.waitForTimeout(80);
    assert.equal(
      await mobile390Page.evaluate(() => window.__vastuApp.state.sat.satPts.length),
      1,
      'Короткая стена (< 100 px) на спутнике отклонена'
    );

    await mobile390Page.touchscreen.tap(m390SatScale.c2.x, m390SatScale.c2.y);
    await mobile390Page.waitForTimeout(100);
    await takeShot(mobile390Page, 'mobile-390x844-sat-step1.png');

    // Нажимаем «Готово» в однострочной панели -> переходим к отметке тех же точек 1 и 2 на КРУПНОМ плане!
    await mobile390Page.locator('#pickingDoneBtn').click();
    await mobile390Page.waitForTimeout(180);

    const m390PlanPick = await mobile390Page.evaluate((verts) => {
      const stageRect = document.getElementById('canvasStage').getBoundingClientRect();
      const barRect = document.getElementById('mobilePickingBar').getBoundingClientRect();
      const zoomControlsRect = document.getElementById('canvasZoomControls').getBoundingClientRect();
      const st = window.__vastuApp.state;
      const xf = st.lastRenderMeta.transform;
      const p1 = xf.planToScreen(verts[0]);
      const p2 = xf.planToScreen(verts[1]);
      const rect = document.getElementById('mapCanvas').getBoundingClientRect();
      return {
        satViewMode: st.satViewMode,
        stageHeight: stageRect.height,
        stageRatio: stageRect.height / window.innerHeight,
        barHeight: barRect.height,
        undoVisible: !document.getElementById('pickingUndoBtn').hidden,
        doneDisabledBefore: document.getElementById('pickingDoneBtn').disabled,
        zoomButtonsVisible: zoomControlsRect.width > 80 && zoomControlsRect.height >= 38,
        wallLenOnLargePlanPx: Math.hypot(p2.x - p1.x, p2.y - p1.y),
        c1: { x: rect.left + p1.x, y: rect.top + p1.y },
        c2: { x: rect.left + p2.x, y: rect.top + p2.y },
      };
    }, planAsset.defaultVertices);

    assert.equal(m390PlanPick.satViewMode, 'plan-pick');
    assert.ok(
      m390PlanPick.stageRatio >= 0.75,
      `390x844 точки на плане: рабочее поле занимает ${(m390PlanPick.stageRatio * 100).toFixed(1)}% экрана (>= 75%)`
    );
    assert.ok(m390PlanPick.barHeight <= 64);
    assert.equal(m390PlanPick.undoVisible, true);
    assert.equal(m390PlanPick.doneDisabledBefore, true);
    assert.equal(m390PlanPick.zoomButtonsVisible, true);
    assert.ok(
      m390PlanPick.wallLenOnLargePlanPx >= 115,
      `На крупном поле плана стена сразу широкая (${m390PlanPick.wallLenOnLargePlanPx.toFixed(1)} px >= 100 px) даже без доп. приближения!`
    );

    // Ставим точки 1 и 2 пальцем на крупном плане
    await mobile390Page.touchscreen.tap(m390PlanPick.c1.x, m390PlanPick.c1.y);
    await mobile390Page.waitForTimeout(80);
    await mobile390Page.touchscreen.tap(m390PlanPick.c2.x, m390PlanPick.c2.y);
    await mobile390Page.waitForTimeout(120);

    assert.equal(
      await mobile390Page.evaluate(() => document.getElementById('pickingDoneBtn').disabled),
      false,
      'После отметки точек 1 и 2 на плане кнопка «Готово» активна'
    );

    // Скриншот: телефон 390x844, шаг 2 с крупным планом при отметке точек!
    await takeShot(mobile390Page, 'mobile-390x844-step2-plan-points.png');

    // Нажимаем «Готово» -> расчёт Севера по спутнику и переход в «Проверка «С»»
    await mobile390Page.locator('#pickingDoneBtn').click();
    await mobile390Page.waitForTimeout(220);

    const m390Verify = await mobile390Page.evaluate(() => {
      const st = window.__vastuApp.state;
      const northBadge = st.lastRenderMeta.placedBadges.find((b) => b.kind === 'north');
      const rect = document.getElementById('mapCanvas').getBoundingClientRect();
      const beforeNorth = st.northAngleDeg;

      // Пробуем покрутить стрелку «С» пальцем — Север НЕ должен изменяться (ручной поворот убран!)
      if (northBadge) {
        const cx = rect.left + (northBadge.x1 + northBadge.x2) * 0.5;
        const cy = rect.top + (northBadge.y1 + northBadge.y2) * 0.5;
        const c = document.getElementById('mapCanvas');
        c.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 41, pointerType: 'touch', clientX: cx, clientY: cy, bubbles: true }));
        c.dispatchEvent(new PointerEvent('pointermove', { pointerId: 41, pointerType: 'touch', clientX: cx + 70, clientY: cy + 40, bubbles: true }));
        c.dispatchEvent(new PointerEvent('pointerup', { pointerId: 41, pointerType: 'touch', clientX: cx + 70, clientY: cy + 40, bubbles: true }));
      }

      return {
        northSet: st.northSet,
        northSource: st.northSource,
        beforeNorth,
        afterDragNorth: st.northAngleDeg,
        hasNorthVerifyArrowOnCanvas: Boolean(northBadge),
        verifyVisible: !document.getElementById('northSubVerify').hidden,
        tiltText: document.getElementById('satHouseTiltLine').textContent.trim(),
        tab2Title: document.querySelector('#tabBtnNorth .mode-tab-title').textContent.trim(),
      };
    });
    assert.equal(m390Verify.northSet, true);
    assert.equal(m390Verify.northSource, 'satellite');
    assert.equal(m390Verify.hasNorthVerifyArrowOnCanvas, true, 'Проверка «С» после расчёта осталась на чертеже');
    assert.equal(m390Verify.afterDragNorth, m390Verify.beforeNorth, 'Стрелка «С» не вращается вручную');
    assert.equal(m390Verify.verifyVisible, true);
    assert.equal(m390Verify.tiltText, 'Дом повёрнут на 22° относительно сторон света');
    assert.equal(m390Verify.tab2Title, '✓ 2. Север');

    await takeShot(mobile390Page, 'mobile-390x844-sat-step2.png');

    // 2.3. Переходим одной кнопкой к Шагу 3 («Далее: 3. Контур стен →») -> крупное поле (>= 75% экрана)
    await mobile390Page.locator('#northNextContourBtn').click();
    await mobile390Page.waitForTimeout(180);

    const m390ContourLayout = await mobile390Page.evaluate((verts) => {
      const stageRect = document.getElementById('canvasStage').getBoundingClientRect();
      const barRect = document.getElementById('mobilePickingBar').getBoundingClientRect();
      const st = window.__vastuApp.state;
      const xf = st.lastRenderMeta.transform;
      const rect = document.getElementById('mapCanvas').getBoundingClientRect();
      const screenPts = verts.map((v) => {
        const s = xf.planToScreen(v);
        return { x: rect.left + s.x, y: rect.top + s.y };
      });
      const extraPt = (() => {
        const s = xf.planToScreen({ x: 140, y: 520 });
        return { x: rect.left + s.x, y: rect.top + s.y };
      })();
      return {
        stageRatio: stageRect.height / window.innerHeight,
        barHeight: barRect.height,
        screenPts,
        extraPt,
      };
    }, planAsset.defaultVertices);

    assert.ok(
      m390ContourLayout.stageRatio >= 0.75,
      `390x844 контур: рабочее поле занимает ${(m390ContourLayout.stageRatio * 100).toFixed(1)}% высоты (>= 75%)`
    );
    assert.ok(m390ContourLayout.barHeight <= 64);

    for (const pt of m390ContourLayout.screenPts) {
      await mobile390Page.touchscreen.tap(pt.x, pt.y);
      await mobile390Page.waitForTimeout(45);
    }
    // Ставим лишний 7-й угол и проверяем кнопку «Отменить» в сжатой строке (не сбрасывает Север!)
    await mobile390Page.touchscreen.tap(m390ContourLayout.extraPt.x, m390ContourLayout.extraPt.y);
    await mobile390Page.waitForTimeout(50);
    assert.equal(await mobile390Page.evaluate(() => window.__vastuApp.state.vertices.length), 7);

    await mobile390Page.locator('#pickingUndoBtn').click();
    await mobile390Page.waitForTimeout(80);
    const m390AfterUndo = await mobile390Page.evaluate(() => ({
      len: window.__vastuApp.state.vertices.length,
      northSet: window.__vastuApp.state.northSet,
      doneDisabled: document.getElementById('pickingDoneBtn').disabled,
      tab3Title: document.querySelector('#tabBtnContour .mode-tab-title').textContent.trim(),
    }));
    assert.equal(m390AfterUndo.len, 6);
    assert.equal(m390AfterUndo.northSet, true);
    assert.equal(m390AfterUndo.doneDisabled, false);
    assert.equal(m390AfterUndo.tab3Title, '✓ 3. Контур стен');

    // Скриншот: телефон 390x844, шаг 3 контур стен с крупным полем!
    await takeShot(mobile390Page, 'mobile-390x844-step3-contour.png');

    // Нажимаем «Готово» -> Шаг 4 («4. Карта»)
    await mobile390Page.locator('#pickingDoneBtn').click();
    await mobile390Page.waitForTimeout(180);

    const m390ReadyMap = await mobile390Page.evaluate(() => ({
      activeTab: window.__vastuApp.state.activeTab,
      placedAxesCount: window.__vastuApp.state.lastRenderMeta.placedAxesCount,
      badges: window.__vastuApp.state.lastRenderMeta.placedBadges,
      exportDisabled: document.getElementById('exportPngBtn').disabled,
    }));
    assert.equal(m390ReadyMap.activeTab, 'layers');
    assert.equal(m390ReadyMap.placedAxesCount, 8);
    assert.equal(m390ReadyMap.exportDisabled, false);
    assertNoOverlappingBadges(m390ReadyMap.badges, 'Mobile 390x844 ready map');

    await takeShot(mobile390Page, 'mobile-390x844.png');
    await mobile390Ctx.close();

    // =========================================================================
    // 3. ТЕЛЕФОН 375x667 (iPhone SE):
    //    - Шаг 1 без плана
    //    - Шаг 2 с крупным планом при отметке точек (>= 75% высоты!)
    //    - Шаг 3 контур с крупным полем (>= 75% высоты!) + масштаб двумя пальцами и +/−/Вписать
    // =========================================================================
    const mobile375Ctx = await browser.newContext({
      viewport: { width: 375, height: 667 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const mobile375Page = await mobile375Ctx.newPage();
    attachGuards(mobile375Page);

    await mobile375Page.goto(baseUrl, { waitUntil: 'networkidle' });
    await mobile375Page.evaluate(() => document.fonts.ready);
    await mobile375Page.waitForTimeout(150);

    // 3.1. Шаг 1 без плана на 375x667
    const m375Step1 = await mobile375Page.evaluate(() => {
      const heroRect = document.getElementById('openPlanHeroBtn').getBoundingClientRect();
      const steps = window.__vastuApp.computeStepsState();
      return {
        disabled: steps.steps.map((s) => s.disabled),
        heroFullyVisible: heroRect.top >= 0 && heroRect.bottom <= window.innerHeight,
        tabsOverflow: Array.from(document.querySelectorAll('.mode-tab')).some(
          (el) => el.scrollWidth > el.clientWidth + 2
        ),
      };
    });
    assert.deepEqual(m375Step1.disabled, [false, true, true, true]);
    assert.equal(
      m375Step1.heroFullyVisible,
      true,
      '375x667: кнопка «Откройте план квартиры» целиком видна без прокрутки'
    );

    await takeShot(mobile375Page, 'mobile-375x667-step1-no-plan.png');

    // Загружаем план и спутник на 375x667
    await mobile375Page.setInputFiles('#planFileInput', {
      name: 'plan-kvartiry.png',
      mimeType: 'image/png',
      buffer: planAsset.buffer,
    });
    await mobile375Page.waitForTimeout(160);

    await mobile375Page.setInputFiles('#satFileInput', {
      name: 'satellite-se.png',
      mimeType: 'image/png',
      buffer: satBufferNeg22,
    });
    await mobile375Page.waitForTimeout(180);

    const m375SatPts = await mobile375Page.evaluate(() => {
      const st = window.__vastuApp.state;
      const xf = st.lastRenderMeta.transform;
      const rad = (-22 * Math.PI) / 180;
      const toSat = (lx, ly) => ({
        x: 390 + lx * Math.cos(rad) - ly * Math.sin(rad),
        y: 844 + lx * Math.sin(rad) + ly * Math.cos(rad),
      });
      const p1 = xf.planToScreen(toSat(-190, -125));
      const p2 = xf.planToScreen(toSat(160, -125));
      const rect = document.getElementById('mapCanvas').getBoundingClientRect();
      return {
        stageRatio: document.getElementById('canvasStage').getBoundingClientRect().height / window.innerHeight,
        c1: { x: rect.left + p1.x, y: rect.top + p1.y },
        c2: { x: rect.left + p2.x, y: rect.top + p2.y },
      };
    });
    assert.ok(m375SatPts.stageRatio >= 0.75, `375x667 спутник: ${(m375SatPts.stageRatio * 100).toFixed(1)}% >= 75%`);

    await mobile375Page.touchscreen.tap(m375SatPts.c1.x, m375SatPts.c1.y);
    await mobile375Page.waitForTimeout(60);
    await mobile375Page.touchscreen.tap(m375SatPts.c2.x, m375SatPts.c2.y);
    await mobile375Page.waitForTimeout(80);
    await mobile375Page.locator('#pickingDoneBtn').click();
    await mobile375Page.waitForTimeout(160);

    // 3.2. Шаг 2 на 375x667: крупный план при отметке точек 1 и 2 (>= 75% высоты экрана!)
    const m375PlanPick = await mobile375Page.evaluate((verts) => {
      const stageRect = document.getElementById('canvasStage').getBoundingClientRect();
      const barRect = document.getElementById('mobilePickingBar').getBoundingClientRect();
      const st = window.__vastuApp.state;
      const xf = st.lastRenderMeta.transform;
      const p1 = xf.planToScreen(verts[0]);
      const p2 = xf.planToScreen(verts[1]);
      const rect = document.getElementById('mapCanvas').getBoundingClientRect();
      return {
        stageHeight: stageRect.height,
        stageRatio: stageRect.height / window.innerHeight,
        barHeight: barRect.height,
        barBottom: barRect.bottom,
        viewportH: window.innerHeight,
        wallScreenPx: Math.hypot(p2.x - p1.x, p2.y - p1.y),
        c1: { x: rect.left + p1.x, y: rect.top + p1.y },
        c2: { x: rect.left + p2.x, y: rect.top + p2.y },
      };
    }, planAsset.defaultVertices);

    assert.ok(
      m375PlanPick.stageRatio >= 0.75,
      `375x667 точки на плане: рабочее поле ${m375PlanPick.stageHeight}px из 667px = ${(m375PlanPick.stageRatio * 100).toFixed(1)}% (>= 75%)`
    );
    assert.ok(m375PlanPick.barHeight <= 60);
    assert.ok(m375PlanPick.barBottom <= m375PlanPick.viewportH + 1, 'Однострочная панель целиком помещается в экран 375x667');
    assert.ok(m375PlanPick.wallScreenPx >= 110, 'Точки 1 и 2 легко ставятся пальцем на 375x667');

    await mobile375Page.touchscreen.tap(m375PlanPick.c1.x, m375PlanPick.c1.y);
    await mobile375Page.waitForTimeout(70);
    await mobile375Page.touchscreen.tap(m375PlanPick.c2.x, m375PlanPick.c2.y);
    await mobile375Page.waitForTimeout(100);

    await takeShot(mobile375Page, 'mobile-375x667-step2-plan-points.png');

    await mobile375Page.locator('#pickingDoneBtn').click();
    await mobile375Page.waitForTimeout(160);
    await mobile375Page.locator('#northNextContourBtn').click();
    await mobile375Page.waitForTimeout(160);

    // 3.3. Шаг 3 на 375x667: контур стен с крупным полем (>= 75% высоты) + проверка pinch-to-zoom и + / − / Вписать
    const pinchAndButtonsCheck = await mobile375Page.evaluate(() => {
      const app = window.__vastuApp;
      const beforeZoom = app.state.zoom;
      const c = document.getElementById('mapCanvas');
      const r = c.getBoundingClientRect();
      const cx = r.left + r.width * 0.5;
      const cy = r.top + r.height * 0.5;

      // Имитируем разведение двумя пальцами (pinch-to-zoom)
      c.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: cx - 30, clientY: cy, bubbles: true }));
      c.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: cx + 30, clientY: cy, bubbles: true }));
      c.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, pointerType: 'touch', clientX: cx - 75, clientY: cy, bubbles: true }));
      c.dispatchEvent(new PointerEvent('pointermove', { pointerId: 2, pointerType: 'touch', clientX: cx + 75, clientY: cy, bubbles: true }));
      c.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, pointerType: 'touch', clientX: cx - 75, clientY: cy, bubbles: true }));
      c.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2, pointerType: 'touch', clientX: cx + 75, clientY: cy, bubbles: true }));
      const afterPinchZoom = app.state.zoom;

      document.getElementById('zoomInBtn').click();
      const afterPlusZoom = app.state.zoom;
      document.getElementById('zoomOutBtn').click();
      const afterMinusZoom = app.state.zoom;
      document.getElementById('zoomFitBtn').click();
      const afterFitZoom = app.state.zoom;

      return {
        stageRatio: document.getElementById('canvasStage').getBoundingClientRect().height / window.innerHeight,
        beforeZoom,
        afterPinchZoom,
        afterPlusZoom,
        afterMinusZoom,
        afterFitZoom,
      };
    });
    assert.ok(
      pinchAndButtonsCheck.stageRatio >= 0.75,
      `375x667 контур: рабочее поле занимает ${(pinchAndButtonsCheck.stageRatio * 100).toFixed(1)}% высоты (>= 75%)`
    );
    assert.ok(pinchAndButtonsCheck.afterPinchZoom > pinchAndButtonsCheck.beforeZoom * 1.4, 'Масштаб двумя пальцами работает');
    assert.ok(pinchAndButtonsCheck.afterPlusZoom > pinchAndButtonsCheck.afterPinchZoom, 'Кнопка «+» работает');
    assert.ok(pinchAndButtonsCheck.afterMinusZoom < pinchAndButtonsCheck.afterPlusZoom, 'Кнопка «−» работает');
    assert.ok(Math.abs(pinchAndButtonsCheck.afterFitZoom - pinchAndButtonsCheck.beforeZoom) < 0.01, 'Кнопка «Вписать» работает');

    await mobile375Page.waitForTimeout(80);
    const m375ContourPts = await mobile375Page.evaluate((verts) => {
      const st = window.__vastuApp.state;
      const xf = st.lastRenderMeta.transform;
      const rect = document.getElementById('mapCanvas').getBoundingClientRect();
      return verts.map((v) => {
        const s = xf.planToScreen(v);
        return { x: rect.left + s.x, y: rect.top + s.y };
      });
    }, planAsset.defaultVertices);

    for (const pt of m375ContourPts) {
      await mobile375Page.touchscreen.tap(pt.x, pt.y);
      await mobile375Page.waitForTimeout(45);
    }
    await mobile375Page.waitForTimeout(100);

    await takeShot(mobile375Page, 'mobile-375x667-step3-contour.png');

    await mobile375Page.locator('#pickingDoneBtn').click();
    await mobile375Page.waitForTimeout(160);
    assert.equal(await mobile375Page.evaluate(() => window.__vastuApp.state.activeTab), 'layers');
    await takeShot(mobile375Page, 'mobile-375x667-step4-map.png');
    await mobile375Ctx.close();

    // =========================================================================
    // 4. СТАРЫЙ ЧЕРНОВИК С «РУЧНЫМ» СЕВЕРОМ В БРАУЗЕРЕ:
    //    открывается без ошибок, сохраняет контур и просит задать Север по спутнику
    // =========================================================================
    const legacyDraftCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const planDataUrl = `data:image/png;base64,${planAsset.buffer.toString('base64')}`;
    await legacyDraftCtx.addInitScript(
      ({ dataUrl, verts }) => {
        const oldManualRecord = {
          version: 2,
          savedAt: Date.now() - 86400000,
          isSamplePlan: false,
          planTitle: 'Мой старый черновик БТИ.png',
          sheetQuarterTurns: 0,
          basePlanWidth: 1400,
          basePlanHeight: 1060,
          basePlanDataUrl: dataUrl,
          vertices: verts,
          northSet: true,
          northAngleDeg: 180, // был задан кнопкой «Снизу 180°» в старой версии (без northSource: 'satellite')
          alignNorthUp: true,
          orthoSnap: true,
          activeTab: 'layers',
          layers: { showSectors: true, showSectorLabels: true, showBrahmastan: true, showPadas: false, sectorOpacity: 0.4 },
        };
        localStorage.setItem('anna_romeo_vastu_karta_session_v2', JSON.stringify(oldManualRecord));
      },
      { dataUrl: planDataUrl, verts: planAsset.defaultVertices }
    );

    const legacyDraftPage = await legacyDraftCtx.newPage();
    attachGuards(legacyDraftPage);
    await legacyDraftPage.goto(baseUrl, { waitUntil: 'networkidle' });
    await legacyDraftPage.waitForTimeout(250);

    const legacyCheck = await legacyDraftPage.evaluate(() => ({
      hasPlan: Boolean(window.__vastuApp.state.planCanvas),
      verticesLen: window.__vastuApp.state.vertices.length,
      northSet: window.__vastuApp.state.northSet,
      northAngleDeg: window.__vastuApp.state.northAngleDeg,
      activeTab: window.__vastuApp.state.activeTab,
      noticeHidden: document.getElementById('legacyNorthNoticeBox').hidden,
      noticeText: document.getElementById('legacyNorthNoticeBox').textContent.trim(),
      exportDisabled: document.getElementById('exportPngBtn').disabled,
      tab1Title: document.querySelector('#tabBtnPlan .mode-tab-title').textContent.trim(),
      tab2Title: document.querySelector('#tabBtnNorth .mode-tab-title').textContent.trim(),
      tab3Title: document.querySelector('#tabBtnContour .mode-tab-title').textContent.trim(),
    }));
    assert.equal(legacyCheck.hasPlan, true, 'План из старого черновика открыт без ошибок');
    assert.equal(legacyCheck.verticesLen, 6, 'Контур стен из старого черновика сохранён');
    assert.equal(legacyCheck.northSet, false, 'Ручной Север из старого черновика сброшен');
    assert.equal(legacyCheck.northAngleDeg, null);
    assert.equal(legacyCheck.activeTab, 'north', 'Открыт шаг «2. Север»');
    assert.equal(legacyCheck.noticeHidden, false, 'Показана просьба задать Север по спутнику');
    assert.match(legacyCheck.noticeText, /Задайте Север по спутнику/i);
    assert.equal(legacyCheck.exportDisabled, true);
    assert.equal(legacyCheck.tab1Title, '✓ 1. План');
    assert.equal(legacyCheck.tab2Title, '2. Север');
    assert.equal(legacyCheck.tab3Title, '✓ 3. Контур стен');

    await legacyDraftCtx.close();

    // =========================================================================
    // 5. ПРОВЕРКА PDF CCITT G4 НА СТАРОМ iOS (без Promise.withResolvers и URL.parse)
    // =========================================================================
    if (fs.existsSync(EXTERNAL_CCITT_PDF)) {
      const legacyIosPdfCtx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
      });
      await legacyIosPdfCtx.addInitScript(() => {
        delete Promise.withResolvers;
        delete URL.parse;
      });
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
        planWidth: window.__vastuApp.state.planWidth,
        activeTab: window.__vastuApp.state.activeTab,
        planErrorHidden: document.getElementById('planErrorBox').hidden,
      }));
      assert.equal(legacyPdfResult.hasPolyfilledWithResolvers, true);
      assert.ok(legacyPdfResult.planWidth > 400);
      assert.equal(legacyPdfResult.activeTab, 'north');
      assert.equal(legacyPdfResult.planErrorHidden, true);
      await legacyIosPdfCtx.close();
    }

    // =========================================================================
    // 6. ТЕЛЕФОН АЛЬБОМНО 844x390 + Android / iPhone / Telegram экспорт
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
    await completeFullSatelliteFlowOnPage(landscapePage, planAsset, satBufferNeg22, -22);
    await landscapePage.locator('#togglePadas').check({ force: true });
    await landscapePage.waitForTimeout(180);

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

    await takeShot(landscapePage, 'mobile-landscape-844x390.png');
    await landscapeCtx.close();

    // Android Chrome: скачивание файла напрямую + отдельная кнопка «Поделиться»
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
    await completeFullSatelliteFlowOnPage(androidPage, planAsset, satBufferNeg22, -22);

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
      window.__vastuApp.recomputeVastuMap();
    });

    const [androidDownload] = await Promise.all([
      androidPage.waitForEvent('download'),
      androidPage.locator('#exportPngBtn').click(),
    ]);
    assert.match(androidDownload.suggestedFilename(), /^karta-kvartiry-\d{4}-\d{2}-\d{2}\.png$/);
    assert.equal(await androidPage.evaluate(() => window.__shareCalls), 0);

    await androidPage.locator('#shareMapBtn').click();
    await androidPage.waitForTimeout(80);
    assert.equal(await androidPage.evaluate(() => window.__shareCalls), 1);
    assert.equal(
      await androidPage.evaluate(() => document.getElementById('saveToastText').textContent),
      'Отправлено'
    );
    await androidCtx.close();

    // Встроенный браузер Telegram: показ готовой карты поверх экрана
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
    await completeFullSatelliteFlowOnPage(tgPage, planAsset, satBufferNeg22, -22);
    await tgPage.locator('#topExportBtn').click();
    await tgPage.waitForTimeout(100);
    const tgOverlayOpen = await tgPage.evaluate(
      () => !document.getElementById('imagePreviewModal').hidden
    );
    assert.equal(tgOverlayOpen, true);
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

    console.log('Скриншоты и браузерные проверки Задачи 20 успешно выполнены:');
    for (const shot of savedScreenshots) {
      console.log(` - ${shot}`);
    }
    console.log('Проверка 4 шагов: 1. План -> 2. Север -> 3. Контур стен -> 4. Карта, галочки и блокировка без плана.');
    console.log('Проверка большого поля плана на 390x844 и 375x667: >= 80% высоты экрана + однострочная панель Отменить/Готово.');
    console.log('Проверка удаления запасного способа и открытия старых черновиков с ручным Севером: пройдена.');
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
