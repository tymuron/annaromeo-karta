/**
 * Генератор учебных Васту-карт для уроков 7, 8, 9 Анны Ромео.
 * Строит карты ТЕМ ЖЕ кодом конструктора (exportMapToPngCanvas из src/renderer.js)
 * через playwright-core + локальный Chrome и локальный сервер scripts/serve.mjs.
 *
 * Выходные файлы (по умолчанию ~/AnnaRomeo/uroki-7-9/maps/):
 *   - kvartira-pady-krug.png / .json
 *   - kvartira-8-sektorov.png / .json
 *   - spalnya.png / .json
 *   - kuhnya.png / .json
 *   - stol.png / .json
 *   - uchastok.png / .json
 *   - contact-sheet.png
 *   - READY.txt
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startServer } from './serve.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const defaultOutDir = path.join(os.homedir(), 'AnnaRomeo', 'uroki-7-9', 'maps');
const outDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : process.env.LESSON_MAPS_OUT_DIR
    ? path.resolve(process.env.LESSON_MAPS_OUT_DIR)
    : defaultOutDir;

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
  throw new Error('Не найден локальный браузер Chrome/Chromium для генерации учебных карт.');
}

const MAP_SPECS = [
  {
    name: 'kvartira-pady-krug',
    planKind: 'sample-apartment',
    title: 'Квартира · 8 секторов + 32 пады',
    layers: {
      showSectors: true,
      showSectorLabels: false,
      showAxes: true,
      showBrahmastan: true,
      showPadas: true,
      showPadaBelts: false,
      showPadaScores: false,
      sectorOpacity: 0.4,
    },
  },
  {
    name: 'kvartira-8-sektorov',
    planKind: 'sample-apartment',
    title: 'Квартира · 8 секторов',
    layers: {
      showSectors: true,
      showSectorLabels: false,
      showAxes: true,
      showBrahmastan: true,
      showPadas: false,
      showPadaBelts: false,
      showPadaScores: false,
      sectorOpacity: 0.4,
    },
  },
  {
    name: 'spalnya',
    planKind: 'spalnya',
    title: 'Спальня · 3,6 × 4,2 м',
    layers: {
      showSectors: true,
      showSectorLabels: false,
      showAxes: true,
      showBrahmastan: true,
      showPadas: false,
      showPadaBelts: false,
      showPadaScores: false,
      sectorOpacity: 0.4,
    },
  },
  {
    name: 'kuhnya',
    planKind: 'kuhnya',
    title: 'Кухня · 3,2 × 4,0 м',
    layers: {
      showSectors: true,
      showSectorLabels: false,
      showAxes: true,
      showBrahmastan: true,
      showPadas: false,
      showPadaBelts: false,
      showPadaScores: false,
      sectorOpacity: 0.4,
    },
  },
  {
    name: 'stol',
    planKind: 'stol',
    title: 'Рабочий стол · 1,4 × 0,7 м',
    layers: {
      showSectors: true,
      showSectorLabels: false,
      showAxes: true,
      showBrahmastan: true,
      showPadas: false,
      showPadaBelts: false,
      showPadaScores: false,
      sectorOpacity: 0.4,
    },
  },
  {
    name: 'uchastok',
    planKind: 'uchastok',
    title: 'Участок · 25 × 40 м',
    layers: {
      showSectors: true,
      showSectorLabels: false,
      showAxes: true,
      showBrahmastan: true,
      showPadas: false,
      showPadaBelts: false,
      showPadaScores: false,
      sectorOpacity: 0.4,
    },
  },
];

async function renderLessonMapInBrowser(page, spec) {
  return page.evaluate(async (cfg) => {
    const sampleMod = await import('./src/sample-plan.js');
    const geomMod = await import('./src/geometry.js');
    const rendererMod = await import('./src/renderer.js');

    function initDraftingSheet(width, height) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      ctx.fillStyle = '#FAF8F4';
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = 'rgba(66, 35, 38, 0.045)';
      ctx.lineWidth = 1;
      for (let x = 40; x < width; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 40; y < height; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
      return { canvas, ctx };
    }

    function drawRectRoomShell(ctx, x0, y0, w, h, wallT = 26) {
      // Наружные капитальные стены
      ctx.fillStyle = '#3B3533';
      ctx.fillRect(x0 - wallT, y0 - wallT, w + wallT * 2, h + wallT * 2);
      // Внутренний пол
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(x0, y0, w, h);
    }

    function drawWindow(ctx, x, y, w, h, horizontal = true) {
      ctx.save();
      ctx.fillStyle = '#FAF8F4';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#3B3533';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
      ctx.strokeStyle = '#6E8594';
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (horizontal) {
        ctx.moveTo(x, y + h * 0.38);
        ctx.lineTo(x + w, y + h * 0.38);
        ctx.moveTo(x, y + h * 0.62);
        ctx.lineTo(x + w, y + h * 0.62);
      } else {
        ctx.moveTo(x + w * 0.38, y);
        ctx.lineTo(x + w * 0.38, y + h);
        ctx.moveTo(x + w * 0.62, y);
        ctx.lineTo(x + w * 0.62, y + h);
      }
      ctx.stroke();
      ctx.restore();
    }

    function drawDoorOpening(ctx, gapRect, hingeX, hingeY, radius, leafAngleRad, arcStartRad, arcEndRad, anticlockwise = false) {
      ctx.save();
      ctx.fillStyle = '#FAF8F4';
      ctx.fillRect(gapRect.x, gapRect.y, gapRect.w, gapRect.h);

      ctx.strokeStyle = '#422326';
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(hingeX, hingeY);
      ctx.lineTo(
        hingeX + Math.cos(leafAngleRad) * radius,
        hingeY + Math.sin(leafAngleRad) * radius
      );
      ctx.stroke();

      ctx.strokeStyle = 'rgba(110, 98, 93, 0.52)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.arc(hingeX, hingeY, radius, arcStartRad, arcEndRad, anticlockwise);
      ctx.stroke();
      ctx.restore();
    }

    function drawDimensionH(ctx, x1, x2, y, label, labelBelow = false) {
      ctx.save();
      ctx.strokeStyle = 'rgba(87, 76, 72, 0.48)';
      ctx.fillStyle = '#6E625D';
      ctx.lineWidth = 1.2;
      ctx.font = '500 15px Manrope, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.beginPath();
      ctx.moveTo(x1, y);
      ctx.lineTo(x2, y);
      ctx.moveTo(x1, y - 10);
      ctx.lineTo(x1, y + 10);
      ctx.moveTo(x2, y - 10);
      ctx.lineTo(x2, y + 10);
      ctx.stroke();
      ctx.fillText(label, (x1 + x2) * 0.5, labelBelow ? y + 20 : y - 18);
      ctx.restore();
    }

    function drawDimensionV(ctx, x, y1, y2, label) {
      ctx.save();
      ctx.strokeStyle = 'rgba(87, 76, 72, 0.48)';
      ctx.fillStyle = '#6E625D';
      ctx.lineWidth = 1.2;
      ctx.font = '500 15px Manrope, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.beginPath();
      ctx.moveTo(x, y1);
      ctx.lineTo(x, y2);
      ctx.moveTo(x - 10, y1);
      ctx.lineTo(x + 10, y1);
      ctx.moveTo(x - 10, y2);
      ctx.lineTo(x + 10, y2);
      ctx.stroke();
      ctx.translate(x - 20, (y1 + y2) * 0.5);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }

    function drawStamp(ctx, rightX, topY, title, subtitle) {
      ctx.save();
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.font = '600 15px Manrope, sans-serif';
      ctx.fillStyle = 'rgba(66, 35, 38, 0.58)';
      ctx.fillText(title, rightX, topY);
      if (subtitle) {
        ctx.font = '400 13.5px Manrope, sans-serif';
        ctx.fillStyle = 'rgba(66, 35, 38, 0.42)';
        ctx.fillText(subtitle, rightX, topY + 22);
      }
      ctx.restore();
    }

    function createSpalnyaPlan() {
      const width = 1240;
      const height = 1040;
      const { canvas, ctx } = initDraftingSheet(width, height);
      const x0 = 200;
      const y0 = 160;
      const w = 840; // 4,20 м (200 px/м)
      const h = 720; // 3,60 м
      const wallT = 26;

      drawRectRoomShell(ctx, x0, y0, w, h, wallT);

      // Окно на северной стене (1,70 м)
      drawWindow(ctx, x0 + 250, y0 - wallT, 340, wallT, true);

      // Дверь на восточной стене у ЮВ (0,85 м, открывается внутрь комнаты)
      drawDoorOpening(
        ctx,
        { x: x0 + w, y: y0 + 500, w: wallT, h: 170 },
        x0 + w,
        y0 + 670,
        162,
        Math.PI,
        Math.PI,
        Math.PI * 1.5,
        false
      );

      // Мебель в тонком архитектурном стиле sample-plan.js
      ctx.save();
      ctx.strokeStyle = 'rgba(82, 74, 71, 0.46)';
      ctx.fillStyle = 'rgba(82, 74, 71, 0.045)';
      ctx.lineWidth = 1.8;

      // Двуспальная кровать (1,60 × 2,00 м = 320 × 400 px) изголовьем к южной стене в ЮЗ/Ю
      const bedX = x0 + 110;
      const bedY = y0 + h - 404;
      const bedW = 320;
      const bedH = 394;
      ctx.fillRect(bedX, bedY, bedW, bedH);
      ctx.strokeRect(bedX, bedY, bedW, bedH);
      // Изголовье у южной стены
      ctx.fillStyle = 'rgba(82, 74, 71, 0.14)';
      ctx.fillRect(bedX, bedY + bedH - 22, bedW, 22);
      ctx.strokeRect(bedX, bedY + bedH - 22, bedW, 22);
      // Две подушки у изголовья
      ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.fillRect(bedX + 24, bedY + bedH - 102, 122, 66);
      ctx.strokeRect(bedX + 24, bedY + bedH - 102, 122, 66);
      ctx.fillRect(bedX + 174, bedY + bedH - 102, 122, 66);
      ctx.strokeRect(bedX + 174, bedY + bedH - 102, 122, 66);
      // Отворот одеяла
      ctx.beginPath();
      ctx.moveTo(bedX, bedY + 135);
      ctx.lineTo(bedX + bedW, bedY + 135);
      ctx.moveTo(bedX, bedY + 150);
      ctx.lineTo(bedX + bedW, bedY + 150);
      ctx.stroke();

      // Прикроватные тумбы (0,45 × 0,45 м)
      ctx.fillStyle = 'rgba(82, 74, 71, 0.045)';
      ctx.fillRect(bedX - 96, bedY + bedH - 96, 86, 86);
      ctx.strokeRect(bedX - 96, bedY + bedH - 96, 86, 86);
      ctx.fillRect(bedX + bedW + 10, bedY + bedH - 96, 86, 86);
      ctx.strokeRect(bedX + bedW + 10, bedY + bedH - 96, 86, 86);

      // Шкаф вдоль западной стены (0,55 × 1,50 м)
      ctx.fillRect(x0 + 8, y0 + 24, 108, 250);
      ctx.strokeRect(x0 + 8, y0 + 24, 108, 250);
      ctx.beginPath();
      ctx.moveTo(x0 + 8, y0 + 149);
      ctx.lineTo(x0 + 116, y0 + 149);
      ctx.stroke();
      ctx.restore();

      // Подписи элементов (разведены с осями и Брахмастаном)
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '600 15px Manrope, sans-serif';
      ctx.fillStyle = '#574C48';
      ctx.fillText('КРОВАТЬ', bedX + bedW * 0.42, bedY + 215);
      ctx.font = '500 13px Manrope, sans-serif';
      ctx.fillStyle = '#7C706B';
      ctx.fillText('ШКАФ', x0 + 62, y0 + 185);
      ctx.font = '600 14px Manrope, sans-serif';
      ctx.fillStyle = '#422326';
      ctx.fillText('ВХОД', x0 + w + 62, y0 + 585);
      ctx.restore();

      drawDimensionH(ctx, x0, x0 + w, y0 - 82, '4,20 м');
      drawDimensionV(ctx, x0 - 78, y0, y0 + h, '3,60 м');
      drawStamp(ctx, x0 + w + wallT, 44, 'УЧЕБНЫЙ ПЛАН · СПАЛЬНЯ (3,6 × 4,2 м · 15,1 м²)', 'Север сверху');

      return {
        canvas,
        width,
        height,
        vertices: [
          { x: x0, y: y0 },
          { x: x0 + w, y: y0 },
          { x: x0 + w, y: y0 + h },
          { x: x0, y: y0 + h },
        ],
      };
    }

    function createKuhnyaPlan() {
      const width = 1220;
      const height = 1000;
      const { canvas, ctx } = initDraftingSheet(width, height);
      const x0 = 210;
      const y0 = 180;
      const w = 800; // 4,00 м (200 px/м)
      const h = 640; // 3,20 м
      const wallT = 26;

      drawRectRoomShell(ctx, x0, y0, w, h, wallT);

      // Окно на северной стене (1,40 м)
      drawWindow(ctx, x0 + 260, y0 - wallT, 280, wallT, true);

      // Дверь на западной стене у ЮЗ (0,80 м, открывается внутрь вверх)
      drawDoorOpening(
        ctx,
        { x: x0 - wallT, y: y0 + 440, w: wallT, h: 160 },
        x0,
        y0 + 600,
        152,
        0,
        -Math.PI / 2,
        0,
        false
      );

      ctx.save();
      ctx.strokeStyle = 'rgba(82, 74, 71, 0.48)';
      ctx.fillStyle = 'rgba(82, 74, 71, 0.045)';
      ctx.lineWidth = 1.8;

      // Г-образная столешница по восточной и южной стенам (глубина 0,60 м = 120 px)
      const cDepth = 120;
      ctx.beginPath();
      ctx.moveTo(x0 + w - cDepth, y0 + 8);
      ctx.lineTo(x0 + w - 4, y0 + 8);
      ctx.lineTo(x0 + w - 4, y0 + h - 4);
      ctx.lineTo(x0 + 270, y0 + h - 4);
      ctx.lineTo(x0 + 270, y0 + h - cDepth);
      ctx.lineTo(x0 + w - cDepth, y0 + h - cDepth);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Мойка на восточной столешнице (в районе СВ/В)
      const sinkX = x0 + w - cDepth + 16;
      const sinkY = y0 + 86;
      const sinkW = 86;
      const sinkH = 126;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
      ctx.fillRect(sinkX, sinkY, sinkW, sinkH);
      ctx.strokeRect(sinkX, sinkY, sinkW, sinkH);
      ctx.strokeRect(sinkX + 10, sinkY + 12, sinkW - 20, sinkH - 24);
      // Слив и смеситель
      ctx.beginPath();
      ctx.arc(sinkX + sinkW * 0.5, sinkY + sinkH * 0.5, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(sinkX + sinkW + 4, sinkY + sinkH * 0.5);
      ctx.lineTo(sinkX + sinkW - 20, sinkY + sinkH * 0.5);
      ctx.stroke();

      // Варочная плита на южной столешнице (в ЮВ)
      const stoveX = x0 + w - 280;
      const stoveY = y0 + h - cDepth + 12;
      const stoveW = 120;
      const stoveH = 96;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.fillRect(stoveX, stoveY, stoveW, stoveH);
      ctx.strokeRect(stoveX, stoveY, stoveW, stoveH);
      const burners = [
        [stoveX + 34, stoveY + 28, 17],
        [stoveX + 86, stoveY + 28, 14],
        [stoveX + 34, stoveY + 68, 14],
        [stoveX + 86, stoveY + 68, 18],
      ];
      for (const [bx, by, br] of burners) {
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(bx, by, br * 0.45, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Обеденный стол (1,20 × 0,80 м = 240 × 160 px) в СЗ/З части + 4 стула
      const tblX = x0 + 56;
      const tblY = y0 + 100;
      const tblW = 240;
      const tblH = 156;
      ctx.fillStyle = 'rgba(82, 74, 71, 0.045)';
      ctx.fillRect(tblX, tblY, tblW, tblH);
      ctx.strokeRect(tblX, tblY, tblW, tblH);

      // 4 стула (2 сверху, 2 снизу)
      const chairs = [
        [tblX + 36, tblY - 34, 60, 26],
        [tblX + 144, tblY - 34, 60, 26],
        [tblX + 36, tblY + tblH + 8, 60, 26],
        [tblX + 144, tblY + tblH + 8, 60, 26],
      ];
      for (const [cx, cy, cw, ch] of chairs) {
        ctx.fillRect(cx, cy, cw, ch);
        ctx.strokeRect(cx, cy, cw, ch);
      }
      ctx.restore();

      // Подписи элементов (разведены с осями и краями стен)
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '600 14px Manrope, sans-serif';
      ctx.fillStyle = '#574C48';
      ctx.fillText('СТОЛ', tblX + tblW * 0.5, tblY + tblH * 0.5);
      ctx.fillText('МОЙКА', sinkX - 42, sinkY + sinkH * 0.5);
      ctx.fillText('ПЛИТА', stoveX - 44, stoveY + stoveH * 0.5);
      ctx.font = '500 12.5px Manrope, sans-serif';
      ctx.fillStyle = '#7C706B';
      ctx.fillText('СТОЛЕШНИЦА', x0 + 332, y0 + h - 56);
      ctx.font = '600 14px Manrope, sans-serif';
      ctx.fillStyle = '#422326';
      ctx.fillText('ВХОД', x0 - wallT - 34, y0 + 520);
      ctx.restore();

      drawDimensionH(ctx, x0, x0 + w, y0 - 82, '4,00 м');
      drawDimensionV(ctx, x0 - 82, y0, y0 + h, '3,20 м');
      drawStamp(ctx, x0 + w + wallT, 44, 'УЧЕБНЫЙ ПЛАН · КУХНЯ (3,2 × 4,0 м · 12,8 м²)', 'Север сверху');

      return {
        canvas,
        width,
        height,
        vertices: [
          { x: x0, y: y0 },
          { x: x0 + w, y: y0 },
          { x: x0 + w, y: y0 + h },
          { x: x0, y: y0 + h },
        ],
      };
    }

    function createStolPlan() {
      const width = 1340;
      const height = 880;
      const { canvas, ctx } = initDraftingSheet(width, height);
      const x0 = 208;
      const y0 = 190;
      const w = 924; // 1,40 м (660 px/м)
      const h = 462; // 0,70 м

      // Стул снизу (пользователь сидит лицом на Север)
      ctx.save();
      ctx.strokeStyle = 'rgba(82, 74, 71, 0.5)';
      ctx.fillStyle = 'rgba(82, 74, 71, 0.06)';
      ctx.lineWidth = 2;
      const chairX = x0 + w * 0.5;
      const chairY = y0 + h + 16;
      // Сиденье
      ctx.beginPath();
      ctx.roundRect(chairX - 108, chairY - 12, 216, 98, 26);
      ctx.fill();
      ctx.stroke();
      // Спинка
      ctx.fillStyle = 'rgba(82, 74, 71, 0.14)';
      ctx.beginPath();
      ctx.roundRect(chairX - 118, chairY + 72, 236, 28, 12);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Столешница рабочего стола (вид сверху)
      ctx.save();
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(x0, y0, w, h);
      ctx.strokeStyle = '#3B3533';
      ctx.lineWidth = 5;
      ctx.strokeRect(x0, y0, w, h);
      ctx.strokeStyle = 'rgba(82, 74, 71, 0.22)';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(x0 + 10, y0 + 10, w - 20, h - 20);
      ctx.restore();

      // Лёгкие схематичные предметы на столе (вид сверху)
      ctx.save();
      ctx.strokeStyle = 'rgba(82, 74, 71, 0.45)';
      ctx.fillStyle = 'rgba(82, 74, 71, 0.045)';
      ctx.lineWidth = 1.6;

      // Монитор у северного края + подставка
      const monW = 310;
      const monX = x0 + (w - monW) * 0.5;
      const monY = y0 + 30;
      ctx.fillRect(monX + 95, monY + 18, 120, 44);
      ctx.strokeRect(monX + 95, monY + 18, 120, 44);
      ctx.fillStyle = 'rgba(82, 74, 71, 0.12)';
      ctx.fillRect(monX, monY, monW, 24);
      ctx.strokeRect(monX, monY, monW, 24);

      // Клавиатура и мышь
      ctx.fillStyle = 'rgba(82, 74, 71, 0.045)';
      ctx.fillRect(monX + 35, monY + 86, 240, 76);
      ctx.strokeRect(monX + 35, monY + 86, 240, 76);
      ctx.beginPath();
      ctx.roundRect(monX + 296, monY + 96, 38, 60, 18);
      ctx.fill();
      ctx.stroke();

      // Настольная лампа в СЗ углу
      ctx.beginPath();
      ctx.arc(x0 + 82, y0 + 78, 34, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x0 + 82, y0 + 78, 10, 0, Math.PI * 2);
      ctx.stroke();

      // Ежедневник на западной стороне
      ctx.fillRect(x0 + 52, y0 + 245, 118, 154);
      ctx.strokeRect(x0 + 52, y0 + 245, 118, 154);
      ctx.beginPath();
      ctx.moveTo(x0 + 66, y0 + 245);
      ctx.lineTo(x0 + 66, y0 + 399);
      ctx.stroke();

      // Стакан/кружка на СВ и лоток для бумаг на В/ЮВ
      ctx.beginPath();
      ctx.arc(x0 + w - 82, y0 + 78, 28, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillRect(x0 + w - 180, y0 + 250, 132, 154);
      ctx.strokeRect(x0 + w - 180, y0 + 250, 132, 154);
      ctx.restore();

      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '500 13.5px Manrope, sans-serif';
      ctx.fillStyle = '#7C706B';
      ctx.fillText('КРЕСЛО (ЛИЦОМ НА СЕВЕР)', chairX, chairY + 122);
      ctx.restore();

      drawDimensionH(ctx, x0, x0 + w, y0 - 54, '1,40 м');
      drawDimensionV(ctx, x0 - 58, y0, y0 + h, '0,70 м');
      drawStamp(ctx, x0 + w, 56, 'УЧЕБНЫЙ ПЛАН · РАБОЧИЙ СТОЛ (1,4 × 0,7 м)', 'Вид сверху · Север сверху');

      return {
        canvas,
        width,
        height,
        vertices: [
          { x: x0, y: y0 },
          { x: x0 + w, y: y0 },
          { x: x0 + w, y: y0 + h },
          { x: x0, y: y0 + h },
        ],
      };
    }

    function createUchastokPlan() {
      const width = 1380;
      const height = 1020;
      const { canvas, ctx } = initDraftingSheet(width, height);
      const x0 = 190;
      const y0 = 205;
      const w = 1000; // 40,0 м (25 px/м)
      const h = 625;  // 25,0 м

      // Дорога вдоль северной границы за забором
      ctx.save();
      ctx.fillStyle = '#ECE9E2';
      ctx.fillRect(x0 - 40, y0 - 102, w + 80, 56);
      ctx.strokeStyle = 'rgba(82, 74, 71, 0.28)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x0 - 40, y0 - 102);
      ctx.lineTo(x0 + w + 40, y0 - 102);
      ctx.moveTo(x0 - 40, y0 - 46);
      ctx.lineTo(x0 + w + 40, y0 - 46);
      ctx.stroke();
      ctx.setLineDash([14, 10]);
      ctx.beginPath();
      ctx.moveTo(x0 - 30, y0 - 74);
      ctx.lineTo(x0 + w + 30, y0 - 74);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '500 13px Manrope, sans-serif';
      ctx.fillStyle = '#7C706B';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('ДОРОГА', x0 + 18, y0 - 74);
      ctx.restore();

      // Поле участка внутри забора
      ctx.save();
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(x0, y0, w, h);

      // Заезд и дорожка от ворот к дому (ворота в СВ до диагонали СВ, чтобы подпись не пересекала ось)
      const gateX = x0 + 600;
      const gateW = 110; // 4,4 м ворота
      const wicketX = gateX + gateW + 14;
      const wicketW = 34; // 1,35 м калитка

      ctx.fillStyle = 'rgba(130, 120, 110, 0.08)';
      ctx.strokeStyle = 'rgba(110, 98, 93, 0.25)';
      ctx.lineWidth = 1.4;
      // Парковочная площадка у ворот
      ctx.fillRect(gateX - 10, y0 + 2, gateW + 58, 130);
      ctx.strokeRect(gateX - 10, y0 + 2, gateW + 58, 130);
      // Дорожка от парковки к крыльцу дома
      ctx.beginPath();
      ctx.moveTo(gateX + 35, y0 + 132);
      ctx.lineTo(gateX + 35, y0 + 255);
      ctx.lineTo(x0 + 390, y0 + 255);
      ctx.lineTo(x0 + 390, y0 + 298);
      ctx.lineTo(x0 + 350, y0 + 298);
      ctx.lineTo(x0 + 350, y0 + 215);
      ctx.lineTo(gateX - 5, y0 + 215);
      ctx.lineTo(gateX - 5, y0 + 132);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Дом (12 × 10 м = 300 × 250 px) в ЮЗ четверти участка
      const houseX = x0 + 80;
      const houseY = y0 + 298;
      const houseW = 310;
      const houseH = 245;
      ctx.fillStyle = '#F6F3EC';
      ctx.strokeStyle = '#3B3533';
      ctx.lineWidth = 3.5;
      ctx.fillRect(houseX, houseY, houseW, houseH);
      ctx.strokeRect(houseX, houseY, houseW, houseH);

      // Четырёхскатная кровля (тонкие архитектурные линии)
      ctx.strokeStyle = 'rgba(82, 74, 71, 0.32)';
      ctx.lineWidth = 1.4;
      const ridgePad = 76;
      ctx.beginPath();
      ctx.moveTo(houseX, houseY);
      ctx.lineTo(houseX + ridgePad, houseY + houseH * 0.5);
      ctx.lineTo(houseX, houseY + houseH);
      ctx.moveTo(houseX + houseW, houseY);
      ctx.lineTo(houseX + houseW - ridgePad, houseY + houseH * 0.5);
      ctx.lineTo(houseX + houseW, houseY + houseH);
      ctx.moveTo(houseX + ridgePad, houseY + houseH * 0.5);
      ctx.lineTo(houseX + houseW - ridgePad, houseY + houseH * 0.5);
      ctx.stroke();

      // Терраса / крыльцо с северной стороны дома
      ctx.fillStyle = 'rgba(82, 74, 71, 0.05)';
      ctx.strokeStyle = 'rgba(82, 74, 71, 0.45)';
      ctx.fillRect(houseX + 210, houseY - 34, 88, 34);
      ctx.strokeRect(houseX + 210, houseY - 34, 88, 34);

      // Схематичные деревья по периметру ЮЗ / З / Ю (не перекрывают центр участка!)
      const trees = [
        [x0 + 42, y0 + 70, 26],
        [x0 + 46, y0 + 150, 22],
        [x0 + 42, y0 + 575, 28],
        [x0 + 125, y0 + 585, 24],
        [x0 + 455, y0 + 575, 26],
        [x0 + 945, y0 + 560, 24],
      ];
      for (const [tx, ty, tr] of trees) {
        ctx.fillStyle = 'rgba(91, 125, 112, 0.09)';
        ctx.strokeStyle = 'rgba(82, 98, 88, 0.36)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(tx, ty, tr, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(tx, ty, 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(82, 98, 88, 0.45)';
        ctx.fill();
      }

      // Небольшой цветник / лужайка на СВ
      ctx.strokeStyle = 'rgba(91, 125, 112, 0.32)';
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.roundRect(x0 + 860, y0 + 185, 105, 180, 18);
      ctx.stroke();
      ctx.setLineDash([]);

      // Забор по периметру (с разрывом под ворота и калитку на северной стороне)
      ctx.strokeStyle = '#3B3533';
      ctx.lineWidth = 4;
      ctx.beginPath();
      // Северная сторона слева от ворот
      ctx.moveTo(x0, y0);
      ctx.lineTo(gateX, y0);
      // Простенок между воротами и калиткой
      ctx.moveTo(gateX + gateW, y0);
      ctx.lineTo(wicketX, y0);
      // Северная сторона справа от калитки -> Восток -> Юг -> Запад
      ctx.moveTo(wicketX + wicketW, y0);
      ctx.lineTo(x0 + w, y0);
      ctx.lineTo(x0 + w, y0 + h);
      ctx.lineTo(x0, y0 + h);
      ctx.closePath();
      ctx.stroke();

      // Столбы забора (квадратики по периметру)
      ctx.fillStyle = '#3B3533';
      const postStep = 62.5;
      for (let px = x0; px <= x0 + w + 0.1; px += postStep) {
        if (!(px > gateX + 4 && px < wicketX + wicketW - 4)) {
          ctx.fillRect(px - 3.5, y0 - 3.5, 7, 7);
        }
        ctx.fillRect(px - 3.5, y0 + h - 3.5, 7, 7);
      }
      for (let py = y0; py <= y0 + h + 0.1; py += postStep) {
        ctx.fillRect(x0 - 3.5, py - 3.5, 7, 7);
        ctx.fillRect(x0 + w - 3.5, py - 3.5, 7, 7);
      }

      // Створки ворот (распахиваются внутрь участка) и калитка
      ctx.strokeStyle = '#422326';
      ctx.lineWidth = 3;
      const halfGate = gateW * 0.5;
      ctx.beginPath();
      ctx.moveTo(gateX, y0);
      ctx.lineTo(gateX, y0 + halfGate);
      ctx.moveTo(gateX + gateW, y0);
      ctx.lineTo(gateX + gateW, y0 + halfGate);
      ctx.moveTo(wicketX, y0);
      ctx.lineTo(wicketX, y0 + wicketW);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(110, 98, 93, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.arc(gateX, y0, halfGate, 0, Math.PI / 2, false);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(gateX + gateW, y0, halfGate, Math.PI / 2, Math.PI, false);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(wicketX, y0, wicketW, 0, Math.PI / 2, false);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // Подписи элементов участка (разведены с осями и метками сторон света)
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '600 17px Manrope, sans-serif';
      ctx.fillStyle = '#4A3F3B';
      ctx.fillText('ДОМ', houseX + 108, houseY + 66);
      ctx.font = '400 14px Manrope, sans-serif';
      ctx.fillStyle = '#7C706B';
      ctx.fillText('12 × 10 м', houseX + 108, houseY + 90);

      ctx.font = '600 13.5px Manrope, sans-serif';
      ctx.fillStyle = '#422326';
      ctx.fillText('ВОРОТА И КАЛИТКА', gateX + (gateW + wicketW + 14) * 0.5, y0 - 22);

      ctx.font = '500 13px Manrope, sans-serif';
      ctx.fillStyle = '#7C706B';
      ctx.fillText('САД', x0 + 912, y0 + 275);
      ctx.fillText('ЗАБОР', x0 + w + 42, y0 + 160);
      ctx.restore();

      // Размеры 40,0 м (внизу ниже плашки «Ю») и 25,0 м (слева)
      drawDimensionH(ctx, x0, x0 + w, y0 + h + 92, '40,0 м', true);
      drawDimensionV(ctx, x0 - 68, y0, y0 + h, '25,0 м');
      drawStamp(ctx, x0 + w, 46, 'УЧЕБНЫЙ ПЛАН · УЧАСТОК (25 × 40 м · 10 соток)', 'Дом, забор, ворота · Север сверху');

      return {
        canvas,
        width,
        height,
        vertices: [
          { x: x0, y: y0 },
          { x: x0 + w, y: y0 },
          { x: x0 + w, y: y0 + h },
          { x: x0, y: y0 + h },
        ],
      };
    }

    let plan;
    if (cfg.planKind === 'sample-apartment') {
      const sample = sampleMod.createSampleFloorPlan();
      plan = {
        canvas: sample.canvas,
        width: sample.width,
        height: sample.height,
        vertices: sample.defaultVertices,
      };
    } else if (cfg.planKind === 'spalnya') {
      plan = createSpalnyaPlan();
    } else if (cfg.planKind === 'kuhnya') {
      plan = createKuhnyaPlan();
    } else if (cfg.planKind === 'stol') {
      plan = createStolPlan();
    } else if (cfg.planKind === 'uchastok') {
      plan = createUchastokPlan();
    } else {
      throw new Error(`Unknown planKind: ${cfg.planKind}`);
    }

    const northAngleDeg = 0;
    const alignNorthUp = true;
    const vastuMap = geomMod.buildVastuMap(plan.vertices, northAngleDeg);

    const exportState = {
      planCanvas: plan.canvas,
      planWidth: plan.width,
      planHeight: plan.height,
      vertices: plan.vertices,
      vastuMap,
      northSet: true,
      northSource: 'satellite',
      northAngleDeg,
      alignNorthUp,
      activeTab: 'layers',
      layers: cfg.layers,
    };

    const pngCanvas = rendererMod.exportMapToPngCanvas(exportState);
    if (!pngCanvas) {
      throw new Error(`exportMapToPngCanvas returned null for ${cfg.name}`);
    }

    const meta = pngCanvas.__exportRenderMeta;
    const headerH = 128; // см. exportMapToPngCanvas в src/renderer.js
    const outWidth = pngCanvas.width;
    const outHeight = pngCanvas.height;

    // Убираем на учебных картах подпись «Метод школы С. А. Балуты» в левом нижнем углу,
    // НЕ изменяя код конструктора для учеников (фон футера сплошной #F4F2ED).
    const pctx = pngCanvas.getContext('2d');
    pctx.save();
    pctx.fillStyle = '#F4F2ED';
    pctx.fillRect(52, outHeight - 54, 1100, 46);
    pctx.restore();

    const xf = meta.transform;
    const round2 = (n) => Math.round(n * 100) / 100;
    const toPngPt = (planPt) => {
      if (!planPt) return null;
      const s = xf.planToScreen(planPt);
      return { x: round2(s.x), y: round2(s.y + headerH) };
    };
    const shiftRect = (r) =>
      r
        ? {
            x1: round2(r.x1),
            y1: round2(r.y1 + headerH),
            x2: round2(r.x2),
            y2: round2(r.y2 + headerH),
          }
        : null;
    const loopsToPngPolys = (pieces) => {
      const loops = geomMod.extractPiecesBoundaryLoops(pieces || []);
      return loops.map((loop) => loop.map(toPngPt));
    };

    const contourPng = vastuMap.vertices.map(toPngPt);
    const centerPng = toPngPt(vastuMap.center);

    const sectorsJson = vastuMap.sectors.map((s) => {
      const polygons = loopsToPngPolys(s.pieces);
      // Основной полигон — контур с наибольшей площадью
      let mainPolygon = polygons[0] || [];
      if (polygons.length > 1) {
        let bestIdx = 0;
        let bestArea = -1;
        polygons.forEach((poly, idx) => {
          const a = geomMod.polygonArea(poly);
          if (a > bestArea) {
            bestArea = a;
            bestIdx = idx;
          }
        });
        mainPolygon = polygons[bestIdx];
      }
      return {
        id: s.id,
        code: s.code,
        name: s.name,
        centerAzimuth: s.centerAzimuth,
        startAzimuth: (s.centerAzimuth - 22.5 + 360) % 360,
        endAzimuth: (s.centerAzimuth + 22.5) % 360,
        fillColor: s.fillColor,
        labelPoint: toPngPt(s.labelPoint),
        axisOuterHit: toPngPt(s.axisOuterHit),
        polygon: mainPolygon,
        polygons,
      };
    });

    const axesJson = (meta.renderedAxes || []).map((a) => ({
      code: a.code,
      isCardinal: a.isCardinal,
      azimuthDeg: a.azimuthDeg,
      from: { x: round2(a.fromScreen.x), y: round2(a.fromScreen.y + headerH) },
      contourPoint: {
        x: round2(a.contourScreen.x),
        y: round2(a.contourScreen.y + headerH),
      },
      to: { x: round2(a.toScreen.x), y: round2(a.toScreen.y + headerH) },
      badgeRect: shiftRect(a.badgeRect),
    }));

    let padasJson = null;
    if (cfg.layers.showPadas && vastuMap.padaGrid) {
      const badgeByNum = new Map();
      for (const b of meta.placedBadges || []) {
        if (b.kind === 'pada') {
          badgeByNum.set(b.number, shiftRect(b));
        }
      }
      padasJson = vastuMap.padaGrid.padas.map((p) => {
        const polygons = loopsToPngPolys(p.pieces);
        const badgeRect = badgeByNum.get(p.number) || null;
        const badgeCenter = badgeRect
          ? {
              x: round2((badgeRect.x1 + badgeRect.x2) * 0.5),
              y: round2((badgeRect.y1 + badgeRect.y2) * 0.5),
            }
          : null;
        return {
          number: p.number,
          name: `Пада ${p.number}`,
          sectorCode: p.sectorCode,
          centerAzimuth: p.centerAzimuth,
          startAzimuth: p.startAzimuth,
          endAzimuth: p.endAzimuth,
          outerWallPoint: toPngPt(p.outerWallHit),
          labelPoint: toPngPt(p.labelPoint),
          badgeCenter,
          badgeRect,
          polygon: polygons[0] || [],
          polygons,
        };
      });
    }

    const brahmastanJson =
      cfg.layers.showBrahmastan && vastuMap.brahmastan
        ? {
            polygons: (vastuMap.brahmastan.outlineLoops || []).map((loop) =>
              loop.map(toPngPt)
            ),
          }
        : null;

    const jsonData = {
      name: cfg.name,
      image: `${cfg.name}.png`,
      title: cfg.title,
      width: outWidth,
      height: outHeight,
      headerHeight: headerH,
      stageRect: { x: 0, y: headerH, width: outWidth, height: 1520 },
      northAngleDeg,
      alignNorthUp,
      center: centerPng,
      contour: contourPng,
      brahmastan: brahmastanJson,
      sectors: sectorsJson,
      axes: axesJson,
      padas: padasJson,
    };

    return {
      dataUrl: pngCanvas.toDataURL('image/png'),
      json: jsonData,
      placedPadasCount: meta.placedPadasCount || 0,
      placedAxesCount: meta.placedAxesCount || 0,
      placedBadges: meta.placedBadges || [],
    };
  }, spec);
}

async function createContactSheet(page, items) {
  const dataUrl = await page.evaluate(async (entries) => {
    const cols = 3;
    const rows = Math.ceil(entries.length / cols);
    const pad = 36;
    const gap = 28;
    const headerH = 74;
    const tileW = 760;
    const tileImgH = 588; // 2400x1858 ratio ~ 1.292
    const captionH = 44;
    const tileH = tileImgH + captionH;

    const sheetW = pad * 2 + cols * tileW + (cols - 1) * gap;
    const sheetH = headerH + pad + rows * tileH + (rows - 1) * gap + pad;

    const canvas = document.createElement('canvas');
    canvas.width = sheetW;
    canvas.height = sheetH;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#F4F2ED';
    ctx.fillRect(0, 0, sheetW, sheetH);

    ctx.fillStyle = '#422326';
    ctx.fillRect(0, 0, sheetW, headerH);
    ctx.fillStyle = '#CABC90';
    ctx.font = '600 30px Cormorant, Georgia, serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('УЧЕБНЫЕ ВАСТУ-КАРТЫ ДЛЯ УРОКОВ 7–9 · КОНТАКТ-ЛИСТ', pad, headerH * 0.5);

    const loadImg = (src) =>
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
      });

    for (let i = 0; i < entries.length; i++) {
      const item = entries[i];
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = pad + col * (tileW + gap);
      const y = headerH + pad + row * (tileH + gap);

      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(x, y, tileW, tileH);
      ctx.strokeStyle = 'rgba(66, 35, 38, 0.28)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, tileW, tileH);

      const img = await loadImg(item.dataUrl);
      ctx.drawImage(img, x, y, tileW, tileImgH);

      ctx.fillStyle = '#422326';
      ctx.font = '600 18px Manrope, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        `${item.name}.png  —  ${item.title}`,
        x + 14,
        y + tileImgH + captionH * 0.5
      );
    }

    return canvas.toDataURL('image/png');
  }, items);

  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const { server, port } = await startServer(0, rootDir);
  const baseUrl = `http://127.0.0.1:${port}`;
  const executablePath = findChromeExecutable();

  const browser = await chromium.launch({
    executablePath,
    headless: true,
  });

  const producedFiles = [];
  const contactItems = [];

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);

    for (const spec of MAP_SPECS) {
      const res = await renderLessonMapInBrowser(page, spec);
      assert.equal(res.placedAxesCount, 8, `${spec.name}: должны быть размещены все 8 осей`);
      if (spec.layers.showPadas) {
        assert.equal(
          res.placedPadasCount,
          32,
          `${spec.name}: должны быть размещены все 32 номера пад`
        );
        assert.equal(res.json.padas.length, 32);
      }
      assert.equal(res.json.sectors.length, 8);

      const pngPath = path.join(outDir, `${spec.name}.png`);
      const jsonPath = path.join(outDir, `${spec.name}.json`);

      const pngBuf = Buffer.from(res.dataUrl.split(',')[1], 'base64');
      fs.writeFileSync(pngPath, pngBuf);
      fs.writeFileSync(jsonPath, JSON.stringify(res.json, null, 2) + '\n', 'utf8');

      producedFiles.push(`${spec.name}.png`, `${spec.name}.json`);
      contactItems.push({
        name: spec.name,
        title: spec.title,
        dataUrl: res.dataUrl,
      });
      console.log(
        `OK ${spec.name}.png (${res.json.width}x${res.json.height}, axes=${res.placedAxesCount}, padas=${res.placedPadasCount})`
      );
    }

    const contactBuf = await createContactSheet(page, contactItems);
    const contactPath = path.join(outDir, 'contact-sheet.png');
    fs.writeFileSync(contactPath, contactBuf);
    producedFiles.push('contact-sheet.png');
    console.log(`OK contact-sheet.png -> ${contactPath}`);

    await context.close();
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`Готово: ${producedFiles.length} файлов записано в ${outDir}`);
}

main().catch((err) => {
  console.error('Ошибка генерации учебных карт:', err);
  process.exit(1);
});
