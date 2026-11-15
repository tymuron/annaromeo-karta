/**
 * Отрисовка плана квартиры, интерактивных инструментов (Север, контур стен)
 * и слоёв Васту-карты (8 секторов по Балуте, Брахмастан по форме квартиры, сетка 32 пад),
 * а также экспорт итоговой карты в PNG высокого разрешения.
 */

import {
  azimuthToUnitVector,
  normalizeDeg,
  isPointInPolygon,
  distance,
} from './geometry.js';
import { SECTORS, BRAHMASTAN_META } from './vastu-data.js';

/**
 * Создаёт матрицу преобразования из координат плана (px исходного изображения)
 * в экранные CSS-координаты холста и обратное преобразование.
 */
export function createViewportTransform({
  planWidth,
  planHeight,
  viewWidth,
  viewHeight,
  zoom,
  panX,
  panY,
  rotationDeg = 0,
}) {
  const cx = planWidth * 0.5;
  const cy = planHeight * 0.5;
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  function planToScreen(pt) {
    const dx = pt.x - cx;
    const dy = pt.y - cy;
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    return {
      x: viewWidth * 0.5 + panX + rx * zoom,
      y: viewHeight * 0.5 + panY + ry * zoom,
    };
  }

  function screenToPlan(pt) {
    const rx = (pt.x - viewWidth * 0.5 - panX) / zoom;
    const ry = (pt.y - viewHeight * 0.5 - panY) / zoom;
    return {
      x: cx + rx * cos + ry * sin,
      y: cy - rx * sin + ry * cos,
    };
  }

  return {
    cx,
    cy,
    rad,
    cos,
    sin,
    zoom,
    planToScreen,
    screenToPlan,
  };
}

function buildPolygonPath2D(vertices) {
  const path = new Path2D();
  if (!vertices || vertices.length === 0) return path;
  path.moveTo(vertices[0].x, vertices[0].y);
  for (let i = 1; i < vertices.length; i++) {
    path.lineTo(vertices[i].x, vertices[i].y);
  }
  if (vertices.length >= 3) {
    path.closePath();
  }
  return path;
}

function buildPiecesPath2D(pieces) {
  const path = new Path2D();
  if (!pieces) return path;
  for (const poly of pieces) {
    if (!poly || poly.length < 3) continue;
    path.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) {
      path.lineTo(poly[i].x, poly[i].y);
    }
    path.closePath();
  }
  return path;
}

function pickSectorBadgePoint(sector, center, contourVertices, avoidCenterFactor = 0.48) {
  const hit = sector.axisOuterHit;
  if (hit && hit.dist > 1) {
    const dir = azimuthToUnitVector(sector.centerPlanDeg);
    const preferred = {
      x: center.x + dir.x * hit.dist * 0.66,
      y: center.y + dir.y * hit.dist * 0.66,
    };
    if (isPointInPolygon(preferred, contourVertices)) {
      const distLabel = distance(center, sector.labelPoint);
      if (distLabel < hit.dist * avoidCenterFactor) {
        return preferred;
      }
      // Усредняем между геометрическим центром куска и лучом 0.66, если оба внутри
      const mid = {
        x: (sector.labelPoint.x + preferred.x) * 0.5,
        y: (sector.labelPoint.y + preferred.y) * 0.5,
      };
      if (isPointInPolygon(mid, contourVertices)) {
        return mid;
      }
      return preferred;
    }
  }
  return sector.labelPoint;
}

/**
 * Рисует сцену (план + слои Васту-карты + интерактивные маркеры) в заданный 2D-контекст.
 */
export function renderScene(ctx, state, options = {}) {
  const {
    viewWidth,
    viewHeight,
    dpr = 1,
    isExport = false,
    backgroundColor = '#31181B',
  } = options;

  const {
    planCanvas,
    planWidth,
    planHeight,
    vertices = [],
    vastuMap = null,
    northAngleDeg = 0,
    activeTab = 'layers',
    selectedVertexIndex = -1,
    hoveredVertexIndex = -1,
    hoveredEdgeMidpoint = null,
    layers = {},
    zoom = 1,
    panX = 0,
    panY = 0,
    alignNorthUp = false,
  } = state;

  const {
    showSectors = true,
    showBrahmastan = true,
    showPadas = false,
    showPadaBelts = true,
    showPadaScores = false,
    sectorOpacity = 0.55,
  } = layers;

  const rotationDeg = alignNorthUp ? -normalizeDeg(northAngleDeg) : 0;
  const xf = createViewportTransform({
    planWidth,
    planHeight,
    viewWidth,
    viewHeight,
    zoom,
    panX,
    panY,
    rotationDeg,
  });

  ctx.save();
  ctx.scale(dpr, dpr);

  // 1. Заливка фона рабочего стола
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, viewWidth, viewHeight);

  if (!isExport) {
    // Деликатный водяной знак бренда на бордовом фоне (~4.5% прозрачности)
    ctx.save();
    ctx.fillStyle = 'rgba(202, 188, 144, 0.045)';
    ctx.font = `italic 400 ${Math.round(Math.min(viewWidth, viewHeight) * 0.22)}px Cormorant, Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ВАСТУ', viewWidth * 0.5, viewHeight * 0.5);
    ctx.restore();
  }

  if (!planCanvas) {
    ctx.restore();
    return { transform: xf, northHandleScreen: null };
  }

  // 2. Вход в координаты плана (с учётом панорамирования, масштаба и поворота «Север сверху»)
  ctx.save();
  ctx.translate(viewWidth * 0.5 + panX, viewHeight * 0.5 + panY);
  ctx.scale(zoom, zoom);
  ctx.rotate(xf.rad);
  ctx.translate(-xf.cx, -xf.cy);

  // Тень под листом плана (на интерактивном холсте)
  if (!isExport) {
    ctx.save();
    ctx.shadowColor = 'rgba(14, 6, 7, 0.55)';
    ctx.shadowBlur = 28 / zoom;
    ctx.shadowOffsetY = 8 / zoom;
    ctx.fillStyle = '#FAF8F4';
    ctx.fillRect(0, 0, planWidth, planHeight);
    ctx.restore();
  }

  // Сам план квартиры
  ctx.drawImage(planCanvas, 0, 0, planWidth, planHeight);

  const hasClosedContour = vertices.length >= 3 && vastuMap && !vastuMap.selfIntersects;
  const contourPath = hasClosedContour ? buildPolygonPath2D(vastuMap.vertices) : null;

  // 3. СЛОЙ 1: 8 радиальных секторов по А. Балуте и палитре Анны Ромео
  if (hasClosedContour && showSectors) {
    ctx.save();
    ctx.clip(contourPath);

    // Мягкое наложение умножением: сохраняет чёткость чёрных стен и подписей плана!
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = Math.max(0.15, Math.min(0.88, sectorOpacity));

    for (const sector of vastuMap.sectors) {
      if (sector.pieces.length === 0) continue;
      ctx.fillStyle = sector.fillColor;
      ctx.fill(buildPiecesPath2D(sector.pieces));
    }

    // Границы между 8 секторами (±22.5° от сторон света)
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(66, 35, 38, 0.48)';
    ctx.lineWidth = (isExport ? 1.8 : 1.35) / zoom;

    const maxReach =
      Math.hypot(planWidth, planHeight) * 1.5;
    for (const sector of vastuMap.sectors) {
      const dir = azimuthToUnitVector(sector.startPlanDeg);
      ctx.beginPath();
      ctx.moveTo(vastuMap.center.x, vastuMap.center.y);
      ctx.lineTo(
        vastuMap.center.x + dir.x * maxReach,
        vastuMap.center.y + dir.y * maxReach
      );
      ctx.stroke();
    }

    // Тонкие пунктирные осевые лучи сторон света
    ctx.strokeStyle = 'rgba(66, 35, 38, 0.20)';
    ctx.lineWidth = (isExport ? 1.1 : 0.9) / zoom;
    ctx.setLineDash([6 / zoom, 6 / zoom]);
    for (const sector of vastuMap.sectors) {
      const dir = azimuthToUnitVector(sector.centerPlanDeg);
      ctx.beginPath();
      ctx.moveTo(vastuMap.center.x, vastuMap.center.y);
      ctx.lineTo(
        vastuMap.center.x + dir.x * maxReach,
        vastuMap.center.y + dir.y * maxReach
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  // 4. СЛОЙ 2: Брахмастан по форме квартиры (1/9 площади, отсечённый по стенам квартиры)
  if (hasClosedContour && showBrahmastan && vastuMap.brahmastan) {
    const bs = vastuMap.brahmastan;
    ctx.save();
    ctx.clip(contourPath);

    // Вспомогательные лучи от центра к внутренним углам квартиры (деление на 3 части по Балуте)
    ctx.strokeStyle = 'rgba(118, 100, 58, 0.32)';
    ctx.lineWidth = (isExport ? 1.1 : 0.95) / zoom;
    ctx.setLineDash([4 / zoom, 5 / zoom]);
    for (const ray of bs.raysToCorners) {
      ctx.beginPath();
      ctx.moveTo(bs.center.x, bs.center.y);
      ctx.lineTo(ray.corner.x, ray.corner.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Заливка Брахмастана (#FCFBF7 — самый светлый участок карты, воздух и баланс)
    const bsPath = buildPiecesPath2D(bs.pieces);
    ctx.fillStyle = BRAHMASTAN_META.fillColor;
    ctx.globalAlpha = 0.78;
    ctx.fill(bsPath);

    // Контур Брахмастана (отсечённый по контуру квартиры)
    ctx.globalAlpha = 1;
    ctx.strokeStyle = BRAHMASTAN_META.strokeColor;
    ctx.lineWidth = (isExport ? 2.6 : 2.1) / zoom;
    ctx.stroke(buildPolygonPath2D(bs.rawVertices));

    // Маленькие засечки на точках внутренней трети
    ctx.fillStyle = BRAHMASTAN_META.strokeColor;
    const dotR = (isExport ? 3.2 : 2.6) / zoom;
    for (const ray of bs.raysToCorners) {
      if (isPointInPolygon(ray.thirdPoint, vastuMap.vertices)) {
        ctx.beginPath();
        ctx.arc(ray.thirdPoint.x, ray.thirdPoint.y, dotR, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  // 5. СЛОЙ 3: Сетка наложения пад (32 радиальные пады по 11,25° + частотные пояса)
  if (hasClosedContour && showPadas && vastuMap.padaGrid) {
    const { padas, belts } = vastuMap.padaGrid;
    ctx.save();
    ctx.clip(contourPath);

    // Если включены баллы пад, мягко подсвечиваем благоприятные внешние пады вдоль стен
    if (showPadaScores) {
      for (const pada of padas) {
        if (pada.score > 0 && pada.pieces.length > 0) {
          ctx.fillStyle = 'rgba(91, 125, 112, 0.14)';
          ctx.fill(buildPiecesPath2D(pada.pieces));
        }
      }
    }

    // Концентрические частотные пояса по форме квартиры (1/9, 3/9, 5/9, 7/9)
    if (showPadaBelts) {
      for (const belt of belts) {
        if (belt.id === 'brahmastan' && showBrahmastan) continue;
        ctx.strokeStyle =
          belt.id === 'bindu'
            ? 'rgba(66, 35, 38, 0.45)'
            : 'rgba(118, 100, 58, 0.48)';
        ctx.lineWidth = (isExport ? 1.35 : 1.1) / zoom;
        ctx.setLineDash(belt.id === 'bindu' ? [] : [5 / zoom, 4 / zoom]);
        ctx.stroke(buildPolygonPath2D(belt.rawVertices));
      }
      ctx.setLineDash([]);
    }

    // 32 радиальных луча границ пад (начинаем от пояса 1/9 Брахмабинду, чтобы не зачернять точку центра)
    const maxReach = Math.hypot(planWidth, planHeight) * 1.5;
    ctx.strokeStyle = 'rgba(66, 35, 38, 0.30)';
    ctx.lineWidth = (isExport ? 1.05 : 0.85) / zoom;

    for (let i = 0; i < padas.length; i++) {
      const pada = padas[i];
      const dir = azimuthToUnitVector(pada.startPlanDeg);
      // Каждая 4-я граница отличается от границ секторов (между ними шаг 11.25°)
      const innerOffset = Math.min(planWidth, planHeight) * 0.025;
      ctx.beginPath();
      ctx.moveTo(
        vastuMap.center.x + dir.x * innerOffset,
        vastuMap.center.y + dir.y * innerOffset
      );
      ctx.lineTo(
        vastuMap.center.x + dir.x * maxReach,
        vastuMap.center.y + dir.y * maxReach
      );
      ctx.stroke();
    }

    ctx.restore();
  }

  // 6. Контур стен квартиры (линия обводки)
  if (vertices.length > 0) {
    ctx.save();
    const polyPath = buildPolygonPath2D(vertices);
    const selfBad = vastuMap && vastuMap.selfIntersects;
    ctx.strokeStyle = selfBad ? '#A62B2B' : '#422326';
    ctx.lineWidth = (isExport ? 3.2 : 2.6) / zoom;
    ctx.lineJoin = 'miter';
    ctx.stroke(polyPath);

    // Если контур ещё не замкнут (2 точки) или редактируется — пунктир замыкающего ребра
    if (vertices.length >= 2 && activeTab === 'contour') {
      ctx.strokeStyle = 'rgba(118, 100, 58, 0.65)';
      ctx.lineWidth = 1.4 / zoom;
      ctx.setLineDash([6 / zoom, 4 / zoom]);
      ctx.beginPath();
      ctx.moveTo(vertices[vertices.length - 1].x, vertices[vertices.length - 1].y);
      ctx.lineTo(vertices[0].x, vertices[0].y);
      ctx.stroke();
    }
    ctx.restore();
  }

  ctx.restore(); // Выход из аффинного пространства плана обратно в экранные CSS-пиксели!

  // ============================================================================
  // 7. ЭКРАННЫЕ ПОДПИСИ И ИНТЕРАКТИВНЫЕ РУЧКИ (всегда горизонтальные и чёткие)
  // ============================================================================
  const fontScale = isExport ? 1.35 : 1;

  // 7а. Номера 32 пад по внешнему периметру контура
  if (hasClosedContour && showPadas && vastuMap.padaGrid) {
    ctx.save();
    const badgeFontPx = Math.round((viewWidth < 500 ? 10 : 11) * fontScale);
    ctx.font = `600 ${badgeFontPx}px Manrope, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const outwardOffsetPx = (showPadaScores ? 19 : 15) * fontScale;

    for (const pada of vastuMap.padaGrid.padas) {
      if (!pada.outerWallHit) continue;
      const wallScreen = xf.planToScreen(pada.outerWallHit);
      const centerScreen = xf.planToScreen(vastuMap.center);
      const dx = wallScreen.x - centerScreen.x;
      const dy = wallScreen.y - centerScreen.y;
      const len = Math.hypot(dx, dy) || 1;
      const bx = wallScreen.x + (dx / len) * outwardOffsetPx;
      const by = wallScreen.y + (dy / len) * outwardOffsetPx;

      const scoreSuffix =
        showPadaScores
          ? ` (${pada.score > 0 ? `+${pada.score}` : pada.score})`
          : '';
      const text = `${pada.number}${scoreSuffix}`;
      const metrics = ctx.measureText(text);
      const padW = Math.max(badgeFontPx + 7, metrics.width + 8 * fontScale);
      const padH = (badgeFontPx + 6) * 1;

      const isGood = pada.score > 0;
      const bg = showPadaScores && isGood ? '#E4EFEA' : '#FAF8F4';
      const border =
        showPadaScores && isGood
          ? '#3F6B5B'
          : 'rgba(66, 35, 38, 0.38)';
      const fg = showPadaScores && isGood ? '#1E3F33' : '#422326';

      ctx.fillStyle = bg;
      ctx.fillRect(bx - padW * 0.5, by - padH * 0.5, padW, padH);
      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      ctx.strokeRect(bx - padW * 0.5, by - padH * 0.5, padW, padH);

      ctx.fillStyle = fg;
      ctx.fillText(text, bx, by + 0.5);
    }
    ctx.restore();
  }

  // 7б. Бейджи 8 секторов (код + формула Анны Ромео на крупном масштабе / экспорте)
  if (hasClosedContour && showSectors) {
    ctx.save();
    const compactMobile = viewWidth < 520 && !isExport;
    for (const sector of vastuMap.sectors) {
      if (sector.sharePercent < 1.2) continue;
      const anchorPlan = pickSectorBadgePoint(
        sector,
        vastuMap.center,
        vastuMap.vertices,
        showBrahmastan ? 0.48 : 0.30
      );
      const pt = xf.planToScreen(anchorPlan);

      const codeFontPx = Math.round((compactMobile ? 12 : 13) * fontScale);
      const subFontPx = Math.round(10 * fontScale);
      ctx.font = `600 ${codeFontPx}px Manrope, sans-serif`;
      const titleLine = compactMobile
        ? sector.code
        : `${sector.code} · ${sector.name}`;
      const w1 = ctx.measureText(titleLine).width;

      let w2 = 0;
      const showFormulaOnCanvas = isExport || viewWidth >= 820;
      if (showFormulaOnCanvas) {
        ctx.font = `400 ${subFontPx}px Manrope, sans-serif`;
        w2 = ctx.measureText(sector.formula).width;
      }

      const boxW = Math.max(w1, w2) + (compactMobile ? 12 : 16) * fontScale;
      const boxH = showFormulaOnCanvas
        ? (codeFontPx + subFontPx + 13) * 1
        : (codeFontPx + 9) * 1;

      ctx.fillStyle = 'rgba(250, 248, 244, 0.90)';
      ctx.fillRect(pt.x - boxW * 0.5, pt.y - boxH * 0.5, boxW, boxH);

      // Цветная полоска палитры слева на плашке
      ctx.fillStyle = sector.fillColor;
      ctx.fillRect(pt.x - boxW * 0.5, pt.y - boxH * 0.5, 4 * fontScale, boxH);

      ctx.strokeStyle = 'rgba(66, 35, 38, 0.32)';
      ctx.lineWidth = 1;
      ctx.strokeRect(pt.x - boxW * 0.5, pt.y - boxH * 0.5, boxW, boxH);

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#422326';
      ctx.font = `600 ${codeFontPx}px Manrope, sans-serif`;
      if (showFormulaOnCanvas) {
        ctx.fillText(titleLine, pt.x + 1.5 * fontScale, pt.y - subFontPx * 0.52);
        ctx.fillStyle = '#5D4B4E';
        ctx.font = `400 ${subFontPx}px Manrope, sans-serif`;
        ctx.fillText(sector.formula, pt.x + 1.5 * fontScale, pt.y + codeFontPx * 0.52);
      } else {
        ctx.fillText(titleLine, pt.x + 1.5 * fontScale, pt.y + 0.5);
      }
    }
    ctx.restore();
  }

  // 7в. Маркер центра квартиры (Брахмабинду) и подпись Брахмастана
  if (hasClosedContour && vastuMap.center) {
    const cScreen = xf.planToScreen(vastuMap.center);
    ctx.save();

    // Тонкое перекрестие и кольцо центра
    const ringR = 8 * fontScale;
    ctx.strokeStyle = '#422326';
    ctx.lineWidth = 1.6 * fontScale;
    ctx.fillStyle = '#FCFBF7';
    ctx.beginPath();
    ctx.arc(cScreen.x, cScreen.y, ringR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#422326';
    ctx.beginPath();
    ctx.arc(cScreen.x, cScreen.y, 2.8 * fontScale, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(cScreen.x - 13 * fontScale, cScreen.y);
    ctx.lineTo(cScreen.x + 13 * fontScale, cScreen.y);
    ctx.moveTo(cScreen.x, cScreen.y - 13 * fontScale);
    ctx.lineTo(cScreen.x, cScreen.y + 13 * fontScale);
    ctx.stroke();

    // Подпись центра / Брахмастана чуть ниже точки центра
    const labelText = showBrahmastan ? 'Брахмастан · Центр' : 'Центр квартиры';
    const fPx = Math.round((viewWidth < 500 && !isExport ? 10.5 : 11.5) * fontScale);
    ctx.font = `600 ${fPx}px Manrope, sans-serif`;
    const lw = ctx.measureText(labelText).width + 12 * fontScale;
    const lh = fPx + 7 * fontScale;
    const ly = cScreen.y + 21 * fontScale;

    ctx.fillStyle = 'rgba(66, 35, 38, 0.92)';
    ctx.fillRect(cScreen.x - lw * 0.5, ly - lh * 0.5, lw, lh);
    ctx.strokeStyle = 'rgba(202, 188, 144, 0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(cScreen.x - lw * 0.5, ly - lh * 0.5, lw, lh);

    ctx.fillStyle = '#CABC90';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(labelText, cScreen.x, ly + 0.5);
    ctx.restore();
  }

  // 7г. Интерактивные вершины и середины стен (в режиме редактирования контура)
  if (!isExport && vertices.length > 0 && activeTab === 'contour') {
    ctx.save();

    // Ручки «+» посередине каждой стены для вставки нового угла
    if (vertices.length >= 3) {
      for (let i = 0; i < vertices.length; i++) {
        const a = xf.planToScreen(vertices[i]);
        const b = xf.planToScreen(vertices[(i + 1) % vertices.length]);
        const segLen = Math.hypot(b.x - a.x, b.y - a.y);
        if (segLen < 38) continue;
        const mx = (a.x + b.x) * 0.5;
        const my = (a.y + b.y) * 0.5;
        const isHovered = hoveredEdgeMidpoint === i;
        const r = isHovered ? 7 : 5;

        ctx.fillStyle = isHovered ? '#422326' : '#FAF8F4';
        ctx.strokeStyle = '#76643A';
        ctx.lineWidth = 1.5;
        ctx.fillRect(mx - r, my - r, r * 2, r * 2);
        ctx.strokeRect(mx - r, my - r, r * 2, r * 2);
      }
    }

    // Узловые точки (углы квартиры) — квадратные маркеры в эстетике бренда
    for (let i = 0; i < vertices.length; i++) {
      const p = xf.planToScreen(vertices[i]);
      const isSelected = i === selectedVertexIndex;
      const isHovered = i === hoveredVertexIndex;
      const half = isSelected || isHovered ? 8 : 6.5;

      ctx.fillStyle = isSelected ? '#422326' : '#FAF8F4';
      ctx.strokeStyle = isSelected ? '#CABC90' : '#422326';
      ctx.lineWidth = isSelected ? 2 : 1.8;
      ctx.fillRect(p.x - half, p.y - half, half * 2, half * 2);
      ctx.strokeRect(p.x - half, p.y - half, half * 2, half * 2);
    }

    ctx.restore();
  }

  // 7д. Стрелка направления на Север (интерактивный компас на плане)
  const compassAnchorPlan =
    hasClosedContour && vastuMap.center
      ? vastuMap.center
      : { x: planWidth * 0.5, y: planHeight * 0.5 };
  const compassOriginScreen = xf.planToScreen(compassAnchorPlan);

  let northHandleScreen = null;
  if (!isExport) {
    const effectiveNorthScreenDeg = normalizeDeg(northAngleDeg + rotationDeg);
    const dir = azimuthToUnitVector(effectiveNorthScreenDeg);

    // Если контур построен, выносим ручку «С» за пределы северной стены, чтобы не перекрывать подписи комнат и зон
    let wallDistPx = 0;
    if (hasClosedContour && vastuMap.sectors && vastuMap.sectors[0]?.axisOuterHit) {
      const northWallScreen = xf.planToScreen(vastuMap.sectors[0].axisOuterHit);
      wallDistPx = distance(compassOriginScreen, northWallScreen);
    }

    const baseR =
      activeTab === 'plan'
        ? Math.max(72, Math.min(viewWidth, viewHeight) * 0.28)
        : Math.max(72, Math.min(viewWidth, viewHeight) * 0.22);

    const desiredR = wallDistPx > 0 ? wallDistPx + (viewWidth < 520 ? 34 : 44) : baseR;
    // Оставляем значок «С» внутри видимой части холста с запасом
    const topSafeY = viewWidth < 520 ? 74 : 48;
    const bottomSafeY = viewWidth < 520 ? 62 : 56;
    const maxAllowedY = dir.y < -0.15 ? (compassOriginScreen.y - topSafeY) / -dir.y : 9999;
    const maxAllowedBottom =
      dir.y > 0.15 ? (viewHeight - bottomSafeY - compassOriginScreen.y) / dir.y : 9999;
    const maxAllowedLeft = dir.x < -0.15 ? (compassOriginScreen.x - 28) / -dir.x : 9999;
    const maxAllowedRight =
      dir.x > 0.15 ? (viewWidth - 28 - compassOriginScreen.x) / dir.x : 9999;
    const maxInBounds = Math.max(
      56,
      Math.min(maxAllowedY, maxAllowedBottom, maxAllowedLeft, maxAllowedRight)
    );
    const clampedR = Math.min(desiredR, maxInBounds);

    const hx = compassOriginScreen.x + dir.x * clampedR;
    const hy = compassOriginScreen.y + dir.y * clampedR;
    northHandleScreen = {
      x: hx,
      y: hy,
      originX: compassOriginScreen.x,
      originY: compassOriginScreen.y,
      radius: clampedR,
    };

    ctx.save();
    if (activeTab === 'plan') {
      // Направляющий лимб компаса в режиме «План и север»
      ctx.strokeStyle = 'rgba(66, 35, 38, 0.32)';
      ctx.lineWidth = 1.25;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(compassOriginScreen.x, compassOriginScreen.y, clampedR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.strokeStyle = '#422326';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(compassOriginScreen.x, compassOriginScreen.y);
      ctx.lineTo(hx, hy);
      ctx.stroke();
    } else {
      // В остальных режимах короткий аккуратный штрих к значку Севера
      ctx.strokeStyle = 'rgba(66, 35, 38, 0.45)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(hx - dir.x * 22, hy - dir.y * 22);
      ctx.lineTo(hx, hy);
      ctx.stroke();
    }

    // Круглая/квадратная ручка стрелки «С» в фирменном бордовом цвете с золотой линией
    const boxR = activeTab === 'plan' ? 19 : 15;
    ctx.fillStyle = '#422326';
    ctx.fillRect(hx - boxR, hy - boxR, boxR * 2, boxR * 2);
    ctx.strokeStyle = '#CABC90';
    ctx.lineWidth = 1.4;
    ctx.strokeRect(hx - boxR, hy - boxR, boxR * 2, boxR * 2);

    // Маленький указатель-стрелка в сторону Севера на границе значка
    const tipDist = boxR + 7;
    const perpX = -dir.y;
    const perpY = dir.x;
    ctx.fillStyle = '#422326';
    ctx.beginPath();
    ctx.moveTo(hx + dir.x * tipDist, hy + dir.y * tipDist);
    ctx.lineTo(hx + dir.x * (boxR - 1) + perpX * 5.5, hy + dir.y * (boxR - 1) + perpY * 5.5);
    ctx.lineTo(hx + dir.x * (boxR - 1) - perpX * 5.5, hy + dir.y * (boxR - 1) - perpY * 5.5);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#CABC90';
    ctx.font = `600 ${activeTab === 'plan' ? 13 : 11.5}px Manrope, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('С', hx, hy + 0.5);
    ctx.restore();
  }

  ctx.restore();
  return { transform: xf, northHandleScreen };
}

/**
 * Формирует итоговый лист PNG высокого качества для прикрепления к домашнему заданию.
 * Содержит план с активными слоями, розу Севера, расшифровку зон и подпись «Васту-карта · Анна Ромео».
 */
export function exportMapToPngCanvas(state) {
  const {
    planCanvas,
    planWidth,
    planHeight,
    northAngleDeg = 0,
    alignNorthUp = false,
    layers = {},
    vastuMap = null,
  } = state;

  if (!planCanvas) return null;

  const outWidth = 2400;
  const headerH = 128;
  const showLegend = Boolean(layers.showSectors || layers.showBrahmastan);
  const footerH = showLegend ? 210 : 88;
  const mapStageH = 1520;
  const outHeight = headerH + mapStageH + footerH;

  const canvas = document.createElement('canvas');
  canvas.width = outWidth;
  canvas.height = outHeight;
  const ctx = canvas.getContext('2d');

  // Фон листа — тёплый кремовый цвет бренда (#F4F2ED)
  ctx.fillStyle = '#F4F2ED';
  ctx.fillRect(0, 0, outWidth, outHeight);

  // Верхняя бордовая плашка с тонкой золотой линией (строго по brend.md)
  ctx.fillStyle = '#422326';
  ctx.fillRect(0, 0, outWidth, headerH);
  ctx.strokeStyle = 'rgba(202, 188, 144, 0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, headerH - 1);
  ctx.lineTo(outWidth, headerH - 1);
  ctx.stroke();

  // Заголовок в шапке
  ctx.fillStyle = '#CABC90';
  ctx.font = '600 44px Cormorant, Georgia, serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('ВАСТУ-КАРТА ПРОСТРАНСТВА', 64, headerH * 0.5);

  const activeLayerNames = [];
  if (layers.showSectors) activeLayerNames.push('8 секторов');
  if (layers.showBrahmastan) activeLayerNames.push('Брахмастан по форме');
  if (layers.showPadas) activeLayerNames.push('Сетка 32 пад');

  ctx.font = '500 21px Manrope, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(202, 188, 144, 0.88)';
  const northLabel = alignNorthUp
    ? `Север сверху (исходный азимут ${Math.round(normalizeDeg(northAngleDeg))}°)`
    : `Азимут Севера на плане: ${Math.round(normalizeDeg(northAngleDeg))}°`;
  ctx.fillText(
    `${activeLayerNames.join(' · ')}   |   ${northLabel}`,
    outWidth - 64,
    headerH * 0.5
  );

  // Расчёт масштаба вписывания плана в поле mapStageH (с учётом возможного поворота «Север сверху»)
  const rotRad = alignNorthUp ? (-normalizeDeg(northAngleDeg) * Math.PI) / 180 : 0;
  const absCos = Math.abs(Math.cos(rotRad));
  const absSin = Math.abs(Math.sin(rotRad));
  const rotatedW = planWidth * absCos + planHeight * absSin;
  const rotatedH = planWidth * absSin + planHeight * absCos;

  const padMargin = 110;
  const fitZoom = Math.min(
    (outWidth - padMargin * 2) / rotatedW,
    (mapStageH - padMargin * 2) / rotatedH
  );

  // Рендерим саму карту на промежуточный холст поля чертежа
  const stageCanvas = document.createElement('canvas');
  stageCanvas.width = outWidth;
  stageCanvas.height = mapStageH;
  const stageCtx = stageCanvas.getContext('2d');

  renderScene(
    stageCtx,
    {
      ...state,
      activeTab: 'layers',
      zoom: fitZoom,
      panX: 0,
      panY: 0,
    },
    {
      viewWidth: outWidth,
      viewHeight: mapStageH,
      dpr: 1,
      isExport: true,
      backgroundColor: '#FAF8F4',
    }
  );

  ctx.drawImage(stageCanvas, 0, headerH);

  // Стрелка Севера в правом верхнем углу поля карты
  const compassX = outWidth - 110;
  const compassY = headerH + 110;
  const effectiveNorthDeg = alignNorthUp ? 0 : normalizeDeg(northAngleDeg);
  const nDir = azimuthToUnitVector(effectiveNorthDeg);

  ctx.save();
  ctx.fillStyle = '#FAF8F4';
  ctx.strokeStyle = 'rgba(66, 35, 38, 0.30)';
  ctx.lineWidth = 2;
  ctx.fillRect(compassX - 58, compassY - 58, 116, 116);
  ctx.strokeRect(compassX - 58, compassY - 58, 116, 116);

  ctx.strokeStyle = '#422326';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(compassX - nDir.x * 28, compassY - nDir.y * 28);
  ctx.lineTo(compassX + nDir.x * 30, compassY + nDir.y * 30);
  ctx.stroke();

  const pX = -nDir.y;
  const pY = nDir.x;
  ctx.fillStyle = '#422326';
  ctx.beginPath();
  ctx.moveTo(compassX + nDir.x * 40, compassY + nDir.y * 40);
  ctx.lineTo(compassX + nDir.x * 20 + pX * 9, compassY + nDir.y * 20 + pY * 9);
  ctx.lineTo(compassX + nDir.x * 20 - pX * 9, compassY + nDir.y * 20 - pY * 9);
  ctx.closePath();
  ctx.fill();

  ctx.font = '700 20px Manrope, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('С', compassX - nDir.x * 40, compassY - nDir.y * 40);
  ctx.restore();

  // Разделительная тонкая линия под полем карты
  const footerTop = headerH + mapStageH;
  ctx.strokeStyle = 'rgba(66, 35, 38, 0.18)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(64, footerTop);
  ctx.lineTo(outWidth - 64, footerTop);
  ctx.stroke();

  // Легенда секторов и их долей площади
  if (showLegend) {
    const items = vastuMap
      ? vastuMap.sectors.map((s) => ({
          code: s.code,
          name: s.name,
          formula: s.formula,
          color: s.fillColor,
          share: `${s.sharePercent.toFixed(1).replace('.', ',')}%`,
        }))
      : SECTORS.map((s) => ({
          code: s.code,
          name: s.name,
          formula: s.formula,
          color: s.fillColor,
          share: '',
        }));

    const cols = 4;
    const colW = (outWidth - 128) / cols;
    const startY = footerTop + 34;

    items.forEach((item, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = 64 + col * colW;
      const y = startY + row * 54;

      ctx.fillStyle = item.color;
      ctx.fillRect(x, y - 14, 28, 28);
      ctx.strokeStyle = 'rgba(66, 35, 38, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y - 14, 28, 28);

      ctx.fillStyle = '#422326';
      ctx.font = '600 19px Manrope, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const head = item.share
        ? `${item.code} · ${item.name} (${item.share})`
        : `${item.code} · ${item.name}`;
      ctx.fillText(head, x + 40, y - 6);

      ctx.fillStyle = '#6E5A5D';
      ctx.font = '400 16px Manrope, sans-serif';
      ctx.fillText(item.formula, x + 40, y + 16);
    });
  }

  // Аккуратная маленькая подпись «Васту-карта · Анна Ромео» внизу листа (по ТЗ п. 6)
  const sigY = outHeight - 32;
  ctx.fillStyle = '#76643A';
  ctx.font = '500 19px Manrope, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText('Васту-карта · Анна Ромео', outWidth - 64, sigY);

  if (vastuMap && layers.showBrahmastan) {
    ctx.textAlign = 'left';
    ctx.fillStyle = '#6E5A5D';
    ctx.font = '400 17px Manrope, sans-serif';
    const bsShare = (vastuMap.brahmastan.shareOfApartment * 100)
      .toFixed(1)
      .replace('.', ',');
    ctx.fillText(
      `Брахмастан по форме квартиры (${bsShare}% площади) · Метод школы С. А. Балуты`,
      64,
      sigY
    );
  }

  return canvas;
}
