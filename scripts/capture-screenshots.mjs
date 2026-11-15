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

async function createSyntheticSatellitePngBuffer(page) {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 900;
    c.height = 680;
    const g = c.getContext('2d');

    // Спутниковая подложка квартала (зелень двора, проезды, крыша дома под углом +22°)
    g.fillStyle = '#334139';
    g.fillRect(0, 0, c.width, c.height);

    // Асфальтовые проезды
    g.strokeStyle = '#565A58';
    g.lineWidth = 42;
    g.beginPath();
    g.moveTo(0, 560);
    g.lineTo(900, 420);
    g.moveTo(150, 0);
    g.lineTo(65, 680);
    g.stroke();

    // Крона деревьев во дворе
    const trees = [
      [210, 140, 34],
      [270, 118, 28],
      [710, 180, 38],
      [760, 250, 30],
      [260, 470, 36],
      [660, 430, 32],
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

    // Тень и Г-образная крыша дома, повёрнутая на +22° относительно Севера сверху
    g.save();
    g.translate(465, 315);
    g.rotate((22 * Math.PI) / 180);

    g.fillStyle = 'rgba(12, 16, 14, 0.45)';
    g.beginPath();
    g.moveTo(-190 + 18, -135 + 22);
    g.lineTo(75 + 18, -135 + 22);
    g.lineTo(75 + 18, -15 + 22);
    g.lineTo(195 + 18, -15 + 22);
    g.lineTo(195 + 18, 145 + 22);
    g.lineTo(-190 + 18, 145 + 22);
    g.closePath();
    g.fill();

    g.fillStyle = '#8B8982';
    g.strokeStyle = '#D8D3C8';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(-190, -135);
    g.lineTo(75, -135);
    g.lineTo(75, -15);
    g.lineTo(195, -15);
    g.lineTo(195, 145);
    g.lineTo(-190, 145);
    g.closePath();
    g.fill();
    g.stroke();

    // Парапет и вентшахты на кровле
    g.strokeStyle = '#6B6963';
    g.lineWidth = 2;
    g.strokeRect(-174, -119, 233, 248);
    g.fillStyle = '#ABA79E';
    g.fillRect(-95, -55, 22, 16);
    g.fillRect(10, -55, 22, 16);
    g.fillRect(95, 45, 22, 16);
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
    // 1. ДЕСКТОП 1440x900 + сохранённая картинка PNG
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

    // Проверяем настройки по умолчанию (Север сверху, пояса и баллы выключены, подпункты скрыты, яркость 40%)
    const defaultsCheck = await desktopPage.evaluate(() => {
      const app = window.__vastuApp;
      const sub = document.getElementById('padaSuboptions');
      return {
        alignNorthUp: app.state.alignNorthUp,
        showPadas: app.state.layers.showPadas,
        showPadaBelts: app.state.layers.showPadaBelts,
        showPadaScores: app.state.layers.showPadaScores,
        sectorOpacity: app.state.layers.sectorOpacity,
        subDisplay: getComputedStyle(sub).display,
      };
    });
    assert.equal(defaultsCheck.alignNorthUp, true, 'По умолчанию Север сверху');
    assert.equal(defaultsCheck.showPadas, false);
    assert.equal(defaultsCheck.showPadaBelts, false, 'Концентрические пояса по умолчанию выключены');
    assert.equal(defaultsCheck.showPadaScores, false, 'Баллы пад по умолчанию выключены');
    assert.equal(defaultsCheck.sectorOpacity, 0.4, 'Яркость цвета зон по умолчанию 40%');
    assert.equal(defaultsCheck.subDisplay, 'none', 'Подпункты сетки пад скрыты при выключенной сетке');

    // Включаем сетку пад для демонстрации итоговой карты на скриншоте
    await desktopPage.locator('#togglePadas').check({ force: true });
    await desktopPage.waitForTimeout(200);

    const desktopBadges = await desktopPage.evaluate(
      () => window.__vastuApp.state.lastRenderMeta.placedBadges
    );
    assertNoOverlappingBadges(desktopBadges, 'Desktop 1440x900');

    const desktopPath = path.join(screenshotsDir, 'desktop-1440x900.png');
    await desktopPage.screenshot({ path: desktopPath });

    // Скачивание итоговой карты и проверка имени файла karta-kvartiry-ГГГГ-ММ-ДД.png
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
    await desktopCtx.close();

    // =========================================================================
    // 2. ТЕЛЕФОН 390x844 — итоговая карта («Север сверху»)
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

    const mobileBadges = await mobilePage.evaluate(
      () => window.__vastuApp.state.lastRenderMeta.placedBadges
    );
    assertNoOverlappingBadges(mobileBadges, 'Mobile 390x844');

    const mobilePath = path.join(screenshotsDir, 'mobile-390x844.png');
    await mobilePage.screenshot({ path: mobilePath });

    // =========================================================================
    // 3. ТЕЛЕФОН 390x844 — загрузка CCITT-скана БТИ и шаги «Север по спутнику»
    // =========================================================================
    const satBuffer = await createSyntheticSatellitePngBuffer(mobilePage);

    // Загружаем реальный CCITT G4 скан БТИ
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
        width: c.width,
        height: c.height,
        maxSide: Math.max(c.width, c.height),
        pixels: c.width * c.height,
        darkPixels,
        northSet: st.northSet,
        northAngleDeg: st.northAngleDeg,
        topExportDisabled: document.getElementById('topExportBtn').disabled,
        badgeText: document.getElementById('northReadoutBadge').textContent,
      };
    });

    assert.equal(ccittCheck.loaded, true, 'CCITT G4 PDF должен открываться');
    assert.ok(ccittCheck.darkPixels > 100, `CCITT G4 скан не должен быть белым листом (найдено тёмных точек: ${ccittCheck.darkPixels})`);
    assert.ok(ccittCheck.maxSide <= 2000, `Сторона рендера PDF <= 2000px (получено ${ccittCheck.maxSide})`);
    assert.ok(ccittCheck.pixels <= 16_000_000, 'Холст PDF <= 16 мегапикселей');
    assert.equal(ccittCheck.northSet, false, 'После загрузки своего плана Север не задан');
    assert.equal(ccittCheck.northAngleDeg, null, 'Не берётся 22° с учебного плана');
    assert.equal(ccittCheck.badgeText, 'Не задан');
    assert.equal(ccittCheck.topExportDisabled, true, 'Скачать карту нельзя без Севера и контура');

    // Загружаем скриншот со спутника и ставим точки 1 и 2 на наружной стене дома
    await mobilePage.setInputFiles('#satFileInput', {
      name: 'satellite-home.png',
      mimeType: 'image/png',
      buffer: satBuffer,
    });
    await mobilePage.waitForTimeout(200);

    // Ставим точку 1 и точку 2 на верхней стене дома на снимке спутника
    const satTapCoords = await mobilePage.evaluate(() => {
      const xf = window.__vastuApp.state.lastRenderMeta.transform;
      const rad = (22 * Math.PI) / 180;
      const toSat = (lx, ly) => ({
        x: 465 + lx * Math.cos(rad) - ly * Math.sin(rad),
        y: 315 + lx * Math.sin(rad) + ly * Math.cos(rad),
      });
      const p1 = xf.planToScreen(toSat(-190, -135));
      const p2 = xf.planToScreen(toSat(75, -135));
      const rect = document.getElementById('mapCanvas').getBoundingClientRect();
      return {
        c1: { x: rect.left + p1.x, y: rect.top + p1.y },
        c2: { x: rect.left + p2.x, y: rect.top + p2.y },
      };
    });

    await mobilePage.touchscreen.tap(satTapCoords.c1.x, satTapCoords.c1.y);
    await mobilePage.waitForTimeout(120);

    // Скриншот шага 1 «Север по спутнику» (отметка стены на спутнике + схема и инструкция внизу)
    const mobileSatStep1Path = path.join(screenshotsDir, 'mobile-390x844-sat-step1.png');
    await mobilePage.screenshot({ path: mobileSatStep1Path });

    await mobilePage.touchscreen.tap(satTapCoords.c2.x, satTapCoords.c2.y);
    await mobilePage.waitForTimeout(200);

    // Теперь конструктор переключился на план — ставим точки 1 и 2 на верхней стене плана
    const planTapCoords = await mobilePage.evaluate(() => {
      const st = window.__vastuApp.state;
      const xf = st.lastRenderMeta.transform;
      const p1 = xf.planToScreen({ x: st.planWidth * 0.22, y: st.planHeight * 0.24 });
      const p2 = xf.planToScreen({ x: st.planWidth * 0.76, y: st.planHeight * 0.24 });
      const rect = document.getElementById('mapCanvas').getBoundingClientRect();
      return {
        c1: { x: rect.left + p1.x, y: rect.top + p1.y },
        c2: { x: rect.left + p2.x, y: rect.top + p2.y },
      };
    });

    await mobilePage.touchscreen.tap(planTapCoords.c1.x, planTapCoords.c1.y);
    await mobilePage.waitForTimeout(100);
    await mobilePage.touchscreen.tap(planTapCoords.c2.x, planTapCoords.c2.y);
    await mobilePage.waitForTimeout(250);

    const afterSatCalc = await mobilePage.evaluate(() => ({
      northSet: window.__vastuApp.state.northSet,
      northAngleDeg: window.__vastuApp.state.northAngleDeg,
      verifyVisible: !document.getElementById('satVerifyBox').hidden,
    }));
    assert.equal(afterSatCalc.northSet, true, 'Север рассчитан по двум отрезкам');
    assert.equal(afterSatCalc.verifyVisible, true, 'Блок проверки направления «С» показан');

    // Скриншот шага 2 «Север по спутнику» (после расчёта видно направление «С» на плане и проверку)
    const mobileSatStep2Path = path.join(screenshotsDir, 'mobile-390x844-sat-step2.png');
    await mobilePage.screenshot({ path: mobileSatStep2Path });

    // Проверка касаний, поля градусов, собственного окна подтверждения и сохранения сессии при перезагрузке
    await mobilePage.locator('#tabBtnContour').click();
    await mobilePage.waitForTimeout(100);
    const contourScrollTop = await mobilePage.evaluate(
      () => document.getElementById('inspectorScroll').scrollTop
    );
    assert.equal(contourScrollTop, 0, 'При смене вкладки панель прокручивается в начало');

    // Добавляем 3 угла контура на плане
    const cornerTaps = await mobilePage.evaluate(() => {
      const st = window.__vastuApp.state;
      const xf = st.lastRenderMeta.transform;
      const rect = document.getElementById('mapCanvas').getBoundingClientRect();
      return [
        { x: st.planWidth * 0.2, y: st.planHeight * 0.2 },
        { x: st.planWidth * 0.8, y: st.planHeight * 0.2 },
        { x: st.planWidth * 0.8, y: st.planHeight * 0.8 },
        { x: st.planWidth * 0.2, y: st.planHeight * 0.8 },
      ].map((p) => {
        const s = xf.planToScreen(p);
        return { x: rect.left + s.x, y: rect.top + s.y };
      });
    });
    for (const c of cornerTaps) {
      await mobilePage.touchscreen.tap(c.x, c.y);
      await mobilePage.waitForTimeout(60);
    }

    const closedBanner = await mobilePage.locator('#canvasStatusBanner').textContent();
    assert.equal(
      closedBanner.trim(),
      'Готово: 4 угла. Неточный угол можно передвинуть пальцем'
    );

    // Выбор существующего угла касанием НЕ создаёт пустой шаг «Отменить»
    const undoBeforeSelect = await mobilePage.evaluate(
      () => window.__vastuApp.state.undoHistory.length
    );
    await mobilePage.touchscreen.tap(cornerTaps[0].x, cornerTaps[0].y);
    const undoAfterSelect = await mobilePage.evaluate(
      () => window.__vastuApp.state.undoHistory.length
    );
    assert.equal(undoAfterSelect, undoBeforeSelect, 'Выбор угла без сдвига не добавляет пустой шаг Отменить');

    // pointercancel не добавляет новый угол
    await mobilePage.evaluate(() => {
      const c = document.getElementById('mapCanvas');
      const r = c.getBoundingClientRect();
      c.dispatchEvent(
        new PointerEvent('pointerdown', {
          pointerId: 77,
          pointerType: 'touch',
          clientX: r.left + r.width * 0.5,
          clientY: r.top + r.height * 0.5,
          bubbles: true,
        })
      );
      c.dispatchEvent(
        new PointerEvent('pointercancel', {
          pointerId: 77,
          pointerType: 'touch',
          clientX: r.left + r.width * 0.5,
          clientY: r.top + r.height * 0.5,
          bubbles: true,
        })
      );
    });
    const verticesAfterCancel = await mobilePage.evaluate(
      () => window.__vastuApp.state.vertices.length
    );
    assert.equal(verticesAfterCancel, 4, 'pointercancel не должен добавлять угол');

    // Проверка восстановления работы из IndexedDB/localStorage после перезагрузки страницы
    await mobilePage.waitForTimeout(350);
    await mobilePage.reload({ waitUntil: 'networkidle' });
    await mobilePage.waitForTimeout(250);
    const restoredSession = await mobilePage.evaluate(() => ({
      isSamplePlan: window.__vastuApp.state.isSamplePlan,
      verticesCount: window.__vastuApp.state.vertices.length,
      northSet: window.__vastuApp.state.northSet,
    }));
    assert.equal(restoredSession.isSamplePlan, false, 'После перезагрузки восстановлен план ученицы');
    assert.equal(restoredSession.verticesCount, 4, 'После перезагрузки восстановлены все 4 угла');
    assert.equal(restoredSession.northSet, true, 'После перезагрузки восстановлен Север');

    // Проверка собственного окна подтверждения перед «Вернуть учебный план»
    await mobilePage.locator('#tabBtnPlan').click();
    await mobilePage.locator('#loadSampleBtn').click();
    const modalShown = await mobilePage.evaluate(
      () => !document.getElementById('confirmModal').hidden
    );
    assert.equal(modalShown, true, 'Показано собственное окно подтверждения');
    await mobilePage.locator('#confirmModalCancelBtn').click();

    // Проверка русской ошибки на битом PDF без английских слов
    await mobilePage.setInputFiles('#planFileInput', {
      name: 'broken.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('NOT_A_VALID_PDF_FILE'),
    });
    await mobilePage.waitForTimeout(100);
    // Подтверждаем замену плана в нашем окне
    await mobilePage.locator('#confirmModalAcceptBtn').click();
    await mobilePage.waitForTimeout(300);
    const errText = (await mobilePage.locator('#planErrorBox').textContent()).trim();
    assert.equal(
      errText,
      'Не получилось открыть этот PDF на телефоне — загрузите план как фото или скриншот'
    );

    await mobileCtx.close();

    // =========================================================================
    // 4. ТЕЛЕФОН АЛЬБОМНО 844x390 (ширина > высоты, высота <= 500 px)
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
        panelW: panel.width,
        panelH: panel.height,
        badges: window.__vastuApp.state.lastRenderMeta.placedBadges,
      };
    });
    assert.ok(
      landscapeLayout.panelLeft >= landscapeLayout.stageW - 2,
      'В альбомной ориентации чертёж и панель расположены рядом'
    );
    assert.ok(landscapeLayout.stageH >= 330 && landscapeLayout.panelH >= 330);
    assertNoOverlappingBadges(landscapeLayout.badges, 'Landscape 844x390');

    const landscapePath = path.join(screenshotsDir, 'mobile-landscape-844x390.png');
    await landscapePage.screenshot({ path: landscapePath });

    // Проверка Web Share API (navigator.canShare + navigator.share с PNG-файлом)
    const sharedPayload = await landscapePage.evaluate(async () => {
      let captured = null;
      Object.defineProperty(navigator, 'canShare', {
        configurable: true,
        value: (data) => Boolean(data && Array.isArray(data.files) && data.files.length === 1),
      });
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (data) => {
          captured = {
            name: data.files[0].name,
            type: data.files[0].type,
            size: data.files[0].size,
          };
        },
      });
      document.getElementById('topExportBtn').click();
      await new Promise((r) => setTimeout(r, 80));
      return {
        captured,
        toastVisible: !document.getElementById('saveToast').hidden,
        toastText: document.getElementById('saveToastText').textContent,
      };
    });
    assert.ok(sharedPayload.captured, 'navigator.share вызван с файлом PNG');
    assert.match(sharedPayload.captured.name, /^karta-kvartiry-\d{4}-\d{2}-\d{2}\.png$/);
    assert.equal(sharedPayload.captured.type, 'image/png');
    assert.ok(sharedPayload.captured.size > 10000);
    assert.equal(sharedPayload.toastVisible, true, 'Показано подтверждение после сохранения');

    // Проверка поворота листа на 90° и совместного возврата по «Отменить»
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
    assert.equal(tgOverlayCheck.modalOpen, true, 'В Telegram открыт экран удержания картинки');
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

    console.log('Скриншоты и браузерные проверки успешно выполнены:');
    console.log(` - ${mobilePath}`);
    console.log(` - ${mobileSatStep1Path}`);
    console.log(` - ${mobileSatStep2Path}`);
    console.log(` - ${landscapePath}`);
    console.log(` - ${desktopPath}`);
    console.log(` - ${exportedSamplePath}`);
    console.log('Проверка CCITT G4 скана БТИ: успешно отрисован, не пустой, <= 2000 px, <= 16 Мп.');
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
