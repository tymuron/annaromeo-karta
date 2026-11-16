/**
 * Отрисовка плана квартиры, спутникового снимка, интерактивных инструментов
 * и слоёв Васту-карты (8 секторов по С. А. Балуте, Брахмастан по форме квартиры, сетка 32 пад),
 * а также экспорт итоговой карты в PNG высокого разрешения.
 */

import {
  azimuthToUnitVector,
  normalizeDeg,
  isPointInPolygon,
  distance,
  computeAxes,
  CENTER_OUTSIDE_NOTE,
  BRAHMASTAN_CLIPPED_NOTE,
  BRAHMASTAN_CLIPPED_BADGE,
} from './geometry.js';
import { SECTORS, BRAHMASTAN_META } from './vastu-data.js';
import { computePlanViewRotationDeg } from './state-helpers.js';

/**
 * Создаёт матрицу преобразования из координат изображения (px)
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
    rotationDeg,
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

function rectsOverlap(a, b, gap = 3) {
  return !(
    a.x2 + gap <= b.x1 ||
    a.x1 - gap >= b.x2 ||
    a.y2 + gap <= b.y1 ||
    a.y1 - gap >= b.y2
  );
}

function makeRect(cx, cy, w, h) {
  return {
    x1: cx - w * 0.5,
    y1: cy - h * 0.5,
    x2: cx + w * 0.5,
    y2: cy + h * 0.5,
  };
}

function isRectInsideView(rect, viewWidth, viewHeight, pad = 4) {
  return (
    rect.x1 >= pad &&
    rect.y1 >= pad &&
    rect.x2 <= viewWidth - pad &&
    rect.y2 <= viewHeight - pad
  );
}

function computeExteriorWallScreenDir(pada, vastuMap, xf) {
  const hit = pada.outerWallHit;
  const pts = vastuMap.vertices;
  if (hit && Number.isInteger(hit.edgeIndex) && pts.length >= 3) {
    const a = pts[hit.edgeIndex];
    const b = pts[(hit.edgeIndex + 1) % pts.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey);
    if (len > 1e-6) {
      const n1 = { x: -ey / len, y: ex / len };
      const probeDist = Math.max(2, Math.min(8, len * 0.1));
      const probe1 = { x: hit.x + n1.x * probeDist, y: hit.y + n1.y * probeDist };
      const outPlan = !isPointInPolygon(probe1, pts) ? n1 : { x: -n1.x, y: -n1.y };
      const s0 = xf.planToScreen(hit);
      const s1 = xf.planToScreen({ x: hit.x + outPlan.x * 10, y: hit.y + outPlan.y * 10 });
      const sdx = s1.x - s0.x;
      const sdy = s1.y - s0.y;
      const slen = Math.hypot(sdx, sdy);
      if (slen > 1e-6) {
        return { x: sdx / slen, y: sdy / slen };
      }
    }
  }
  const wallScreen = xf.planToScreen(hit);
  const centerScreen = xf.planToScreen(vastuMap.center);
  const dx = wallScreen.x - centerScreen.x;
  const dy = wallScreen.y - centerScreen.y;
  const dlen = Math.hypot(dx, dy) || 1;
  return { x: dx / dlen, y: dy / dlen };
}

/**
 * Отрисовка пары опорных точек «1» и «2» с направленной стрелкой вдоль стены.
 */
function drawWallSegmentMarkers(ctx, screenPts, accentBg = '#422326', accentFg = '#CABC90') {
  if (!screenPts || screenPts.length === 0) return;
  ctx.save();

  if (screenPts.length >= 2) {
    const p1 = screenPts[0];
    const p2 = screenPts[1];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);

    if (len > 4) {
      const ux = dx / len;
      const uy = dy / len;

      // Светлая подложка линии для контраста на спутниковом снимке и чертеже
      ctx.strokeStyle = 'rgba(250, 248, 244, 0.92)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();

      ctx.strokeStyle = accentBg;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();

      // Стрелка направления 1 -> 2 посередине отрезка
      if (len > 42) {
        const mx = (p1.x + p2.x) * 0.5 + ux * 7;
        const my = (p1.y + p2.y) * 0.5 + uy * 7;
        const px = -uy;
        const py = ux;
        ctx.fillStyle = accentBg;
        ctx.beginPath();
        ctx.moveTo(mx, my);
        ctx.lineTo(mx - ux * 13 + px * 6, my - uy * 13 + py * 6);
        ctx.lineTo(mx - ux * 13 - px * 6, my - uy * 13 - py * 6);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  for (let i = 0; i < Math.min(2, screenPts.length); i++) {
    const pt = screenPts[i];
    const half = 13;
    ctx.fillStyle = accentBg;
    ctx.fillRect(pt.x - half, pt.y - half, half * 2, half * 2);
    ctx.strokeStyle = accentFg;
    ctx.lineWidth = 2;
    ctx.strokeRect(pt.x - half, pt.y - half, half * 2, half * 2);

    ctx.fillStyle = accentFg;
    ctx.font = '700 13px Manrope, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), pt.x, pt.y + 0.5);
  }

  ctx.restore();
}

/**
 * Отрисовка режима разметки спутникового снимка (точки 1 и 2).
 */
function renderSatelliteScene(ctx, state, options) {
  const { viewWidth, viewHeight, dpr = 1, backgroundColor = '#31181B' } = options;
  const sat = state.sat;
  const xf = createViewportTransform({
    planWidth: sat.width,
    planHeight: sat.height,
    viewWidth,
    viewHeight,
    zoom: state.satZoom || 1,
    panX: state.satPanX || 0,
    panY: state.satPanY || 0,
    rotationDeg: 0,
  });

  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, viewWidth, viewHeight);

  ctx.save();
  ctx.translate(viewWidth * 0.5 + (state.satPanX || 0), viewHeight * 0.5 + (state.satPanY || 0));
  ctx.scale(state.satZoom || 1, state.satZoom || 1);
  ctx.translate(-xf.cx, -xf.cy);

  ctx.save();
  ctx.shadowColor = 'rgba(14, 6, 7, 0.55)';
  ctx.shadowBlur = 24 / (state.satZoom || 1);
  ctx.fillStyle = '#1E1416';
  ctx.fillRect(0, 0, sat.width, sat.height);
  ctx.restore();

  ctx.drawImage(sat.canvas, 0, 0, sat.width, sat.height);
  ctx.restore();

  // Экранные маркеры точек 1 и 2 на спутниковом снимке
  const satScreenPts = (sat.satPts || []).map((p) => xf.planToScreen(p));
  drawWallSegmentMarkers(ctx, satScreenPts, '#422326', '#CABC90');

  // Небольшая плашка-памятка внутри правого верхнего угла снимка: Север на спутнике сверху
  const satTopRight = xf.planToScreen({ x: sat.width, y: 0 });
  const badgeText = 'С ↑ на снимке сверху';
  ctx.save();
  ctx.font = '600 11px Manrope, sans-serif';
  const bw = ctx.measureText(badgeText).width + 16;
  const bh = 24;
  const bx = Math.max(10, Math.min(viewWidth - bw - 10, satTopRight.x - bw - 8));
  const by = Math.max(viewWidth < 520 ? 64 : 14, satTopRight.y + 8);
  ctx.fillStyle = 'rgba(49, 24, 27, 0.90)';
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = 'rgba(202, 188, 144, 0.55)';
  ctx.lineWidth = 1;
  ctx.strokeRect(bx, by, bw, bh);
  ctx.fillStyle = '#CABC90';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(badgeText, bx + bw * 0.5, by + bh * 0.5 + 0.5);
  ctx.restore();

  ctx.restore();
  return {
    transform: xf,
    northHandleScreen: null,
    placedBadges: [],
    placedAxesCount: 0,
    renderedAxes: [],
    hiddenPadasCount: 0,
    totalPadasCount: 0,
    isSatelliteView: true,
  };
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
    extraBlockedRects = [],
  } = options;

  if (
    !isExport &&
    (state.activeTab === 'north' || state.activeTab === 'plan') &&
    state.satViewMode === 'sat' &&
    state.sat &&
    state.sat.canvas
  ) {
    return renderSatelliteScene(ctx, state, options);
  }

  const {
    planCanvas,
    planWidth,
    planHeight,
    vertices = [],
    vastuMap = null,
    northSet = false,
    northAngleDeg = null,
    activeTab = 'layers',
    selectedVertexIndex = -1,
    hoveredVertexIndex = -1,
    hoveredEdgeMidpoint = null,
    layers = {},
    zoom = 1,
    panX = 0,
    panY = 0,
    alignNorthUp = true,
    frozenRotationDeg = null,
    satViewMode = 'idle',
    sat = null,
  } = state;

  const {
    showSectors = true,
    showSectorLabels = false,
    showAxes = true,
    showBrahmastan = true,
    showPadas = false,
    showPadaBelts = false,
    showPadaScores = false,
    sectorOpacity = 0.4,
  } = layers;

  const hasValidNorth = Boolean(northSet && Number.isFinite(northAngleDeg));
  const isPickingPlanWall =
    !isExport &&
    (activeTab === 'north' || activeTab === 'plan') &&
    satViewMode === 'plan-pick';

  const rotationDeg = computePlanViewRotationDeg({
    isExport,
    activeTab,
    satViewMode,
    northSet,
    northAngleDeg,
    alignNorthUp,
    frozenRotationDeg,
  });

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

  if (!isExport && planCanvas) {
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
    if (!isExport) {
      ctx.save();
      const cardW = Math.min(viewWidth - 36, 360);
      const cardH = Math.min(viewHeight - 28, 128);
      if (cardW >= 180 && cardH >= 74) {
        const cx0 = (viewWidth - cardW) * 0.5;
        const cy0 = (viewHeight - cardH) * 0.5;
        ctx.fillStyle = 'rgba(66, 35, 38, 0.52)';
        ctx.fillRect(cx0, cy0, cardW, cardH);
        ctx.strokeStyle = 'rgba(202, 188, 144, 0.36)';
        ctx.lineWidth = 1;
        ctx.strokeRect(cx0, cy0, cardW, cardH);

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#CABC90';
        ctx.font = '600 11px Manrope, sans-serif';
        ctx.fillText('ШАГ 1 ИЗ 4', viewWidth * 0.5, cy0 + cardH * 0.32);

        ctx.font = 'italic 600 22px Cormorant, Georgia, serif';
        ctx.fillText('План квартиры', viewWidth * 0.5, cy0 + cardH * 0.62);
      }
      ctx.restore();
    }
    ctx.restore();
    return {
      transform: xf,
      northHandleScreen: null,
      placedBadges: [],
      placedAxesCount: 0,
      renderedAxes: [],
      hiddenPadasCount: 0,
      totalPadasCount: 0,
    };
  }

  // 2. Вход в координаты плана (с учётом панорамирования, масштаба и поворота «Север сверху»)
  ctx.save();
  ctx.translate(viewWidth * 0.5 + panX, viewHeight * 0.5 + panY);
  ctx.scale(zoom, zoom);
  ctx.rotate(xf.rad);
  ctx.translate(-xf.cx, -xf.cy);

  if (!isExport) {
    ctx.save();
    ctx.shadowColor = 'rgba(14, 6, 7, 0.55)';
    ctx.shadowBlur = 28 / zoom;
    ctx.shadowOffsetY = 8 / zoom;
    ctx.fillStyle = '#FAF8F4';
    ctx.fillRect(0, 0, planWidth, planHeight);
    ctx.restore();
  }

  ctx.drawImage(planCanvas, 0, 0, planWidth, planHeight);

  const hasClosedContour = vertices.length >= 3 && vastuMap && !vastuMap.selfIntersects;
  const canShowMapLayers =
    (isExport || activeTab === 'layers') && hasClosedContour && hasValidNorth;
  const contourPath = hasClosedContour ? buildPolygonPath2D(vastuMap.vertices) : null;

  // 3. СЛОЙ 1: 8 радиальных секторов по С. А. Балуте и палитре Анны Ромео (только когда Север задан)
  if (canShowMapLayers && showSectors && vastuMap.sectors.length > 0) {
    ctx.save();
    ctx.clip(contourPath);

    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = Math.max(0.1, Math.min(0.92, sectorOpacity));

    for (const sector of vastuMap.sectors) {
      if (sector.pieces.length === 0) continue;
      ctx.fillStyle = sector.fillColor;
      ctx.fill(buildPiecesPath2D(sector.pieces));
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(66, 35, 38, 0.48)';
    ctx.lineWidth = (isExport ? 1.8 : 1.35) / zoom;

    const maxReach = Math.hypot(planWidth, planHeight) * 1.5;
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
    ctx.restore();
  }

  // 4. СЛОЙ 2: Брахмастан по форме квартиры (не рисуется пустым, если центр вне стен или почти весь отсечён)
  if (
    canShowMapLayers &&
    showBrahmastan &&
    vastuMap.brahmastan &&
    !vastuMap.centerOutsideOrClipped &&
    !vastuMap.brahmastan.isEmpty
  ) {
    const bs = vastuMap.brahmastan;
    ctx.save();
    ctx.clip(contourPath);

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

    const bsFillLoops =
      bs.outlineLoops && bs.outlineLoops.length > 0 ? bs.outlineLoops : bs.pieces;
    const bsOutlinePath =
      bs.wasClipped
        ? buildPiecesPath2D(bsFillLoops)
        : buildPolygonPath2D(bs.rawVertices);

    ctx.fillStyle = BRAHMASTAN_META.fillColor;
    ctx.globalAlpha = 0.85;
    ctx.fill(bsOutlinePath);

    ctx.globalAlpha = 1;
    ctx.strokeStyle = BRAHMASTAN_META.strokeColor;
    ctx.lineWidth = (isExport ? 2.6 : 2.1) / zoom;
    ctx.lineJoin = 'miter';
    ctx.stroke(bsOutlinePath);

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

  // 5. СЛОЙ 3: Сетка наложения пад (32 радиальные пады по 11,25° + опциональные пояса и баллы)
  if (canShowMapLayers && showPadas && vastuMap.padaGrid) {
    const { padas, belts } = vastuMap.padaGrid;
    ctx.save();
    ctx.clip(contourPath);

    if (showPadaScores) {
      for (const pada of padas) {
        if (pada.score > 0 && pada.pieces.length > 0) {
          ctx.fillStyle = 'rgba(91, 125, 112, 0.14)';
          ctx.fill(buildPiecesPath2D(pada.pieces));
        }
      }
    }

    if (showPadaBelts) {
      for (const belt of belts) {
        if (
          belt.id === 'brahmastan' &&
          showBrahmastan &&
          !vastuMap.centerOutsideOrClipped
        ) {
          continue;
        }
        if (belt.area <= 1e-5) continue;
        ctx.strokeStyle =
          belt.id === 'bindu'
            ? 'rgba(66, 35, 38, 0.45)'
            : 'rgba(118, 100, 58, 0.48)';
        ctx.lineWidth = (isExport ? 1.35 : 1.1) / zoom;
        ctx.setLineDash(belt.id === 'bindu' ? [] : [5 / zoom, 4 / zoom]);
        const beltLoops =
          belt.outlineLoops && belt.outlineLoops.length > 0
            ? belt.outlineLoops
            : belt.pieces;
        ctx.stroke(buildPiecesPath2D(beltLoops));
      }
      ctx.setLineDash([]);
    }

    const maxReach = Math.hypot(planWidth, planHeight) * 1.5;
    ctx.strokeStyle = 'rgba(66, 35, 38, 0.30)';
    ctx.lineWidth = (isExport ? 1.05 : 0.85) / zoom;

    const innerOffset = Math.min(planWidth, planHeight) * 0.025;
    for (let i = 0; i < padas.length; i++) {
      const pada = padas[i];
      const dir = azimuthToUnitVector(pada.startPlanDeg);
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

  // 6. Контур стен квартиры
  if (vertices.length > 0) {
    ctx.save();
    const polyPath = buildPolygonPath2D(vertices);
    const selfBad = vastuMap && vastuMap.selfIntersects;
    ctx.strokeStyle = selfBad ? '#A62B2B' : '#422326';
    ctx.lineWidth = (isExport ? 3.2 : 2.6) / zoom;
    ctx.lineJoin = 'miter';
    ctx.stroke(polyPath);

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

  ctx.restore(); // Возврат в экранные CSS-координаты

  // ============================================================================
  // 7. ОСИ СТОРОН СВЕТА, ЭКРАННЫЕ ПОДПИСИ, ОПОРНАЯ СТЕНА 1->2 И РУЧКИ (без наложений)
  // ============================================================================
  const fontScale = isExport ? 1.35 : 1;
  const placedBadges = [];
  const hudBlockedRects = isExport
    ? [...extraBlockedRects]
    : [
        { x1: 0, y1: 0, x2: viewWidth, y2: 50 },
        { x1: viewWidth - 180, y1: viewHeight - 54, x2: viewWidth, y2: viewHeight },
        ...extraBlockedRects,
      ];

  function hasCollision(candidateRect, gap = 3, checkHud = false) {
    for (const r of placedBadges) {
      if (rectsOverlap(candidateRect, r, gap)) return true;
    }
    if (checkHud) {
      for (const h of hudBlockedRects) {
        if (rectsOverlap(candidateRect, h, 2)) return true;
      }
    }
    return false;
  }

  // 7.0. Опорные точки «1» и «2» стены на плане (во вкладке «2. Север»; в «Проверка С» — только для показа)
  if (
    !isExport &&
    (activeTab === 'north' || activeTab === 'plan') &&
    sat &&
    (satViewMode === 'plan-pick' || satViewMode === 'done') &&
    sat.planPts &&
    sat.planPts.length > 0
  ) {
    const planWallScreenPts = sat.planPts.map((p) => xf.planToScreen(p));
    ctx.save();
    if (satViewMode === 'done') {
      ctx.globalAlpha = 0.85;
    }
    drawWallSegmentMarkers(ctx, planWallScreenPts, '#76643A', '#FAF8F4');
    ctx.restore();
  }

  // 7.1. Стрелка проверки направления «С» после расчёта по спутнику (без ручного поворота!)
  const northHandleScreen = null;
  let northHandleDraw = null;
  const showVerifyNorthArrow =
    !isExport && activeTab === 'north' && hasValidNorth && !isPickingPlanWall;
  const showPassiveNorthBadge =
    !isExport &&
    activeTab !== 'north' &&
    activeTab !== 'contour' &&
    hasValidNorth &&
    !(canShowMapLayers && showAxes);

  if (showVerifyNorthArrow || showPassiveNorthBadge) {
    const northAnchorPlan =
      hasClosedContour && vastuMap.center
        ? vastuMap.center
        : { x: planWidth * 0.5, y: planHeight * 0.5 };
    const northOriginScreen = xf.planToScreen(northAnchorPlan);

    const displayNorthPlanDeg = normalizeDeg(northAngleDeg);
    const effectiveNorthScreenDeg = normalizeDeg(displayNorthPlanDeg + rotationDeg);
    const dir = azimuthToUnitVector(effectiveNorthScreenDeg);
    const boxR = showVerifyNorthArrow ? 20 : 14;

    // Вычисляем вынос значка строго ЗА пределы контура квартиры (и краёв листа, если контура нет)
    let minOutsideR = showVerifyNorthArrow
      ? Math.max(74, Math.min(viewWidth, viewHeight) * 0.28)
      : Math.max(64, Math.min(viewWidth, viewHeight) * 0.22);

    if (vertices.length >= 3) {
      let maxProj = 0;
      for (const v of vertices) {
        const vs = xf.planToScreen(v);
        const proj =
          (vs.x - northOriginScreen.x) * dir.x +
          (vs.y - northOriginScreen.y) * dir.y;
        if (proj > maxProj) maxProj = proj;
      }
      minOutsideR = Math.max(minOutsideR, maxProj + boxR + 20);
    } else {
      const corners = [
        { x: 0, y: 0 },
        { x: planWidth, y: 0 },
        { x: planWidth, y: planHeight },
        { x: 0, y: planHeight },
      ];
      let maxSheetProj = 0;
      for (const c of corners) {
        const cs = xf.planToScreen(c);
        const proj =
          (cs.x - northOriginScreen.x) * dir.x +
          (cs.y - northOriginScreen.y) * dir.y;
        if (proj > maxSheetProj) maxSheetProj = proj;
      }
      minOutsideR = Math.min(
        Math.max(70, maxSheetProj - boxR - 6),
        Math.max(82, Math.min(viewWidth, viewHeight) * 0.34)
      );
    }

    const topSafeY = 56 + boxR;
    const bottomSafeY = 56 + boxR;
    const sideSafeX = 12 + boxR;
    const maxTop = dir.y < -0.12 ? (northOriginScreen.y - topSafeY) / -dir.y : 9999;
    const maxBottom =
      dir.y > 0.12 ? (viewHeight - bottomSafeY - northOriginScreen.y) / dir.y : 9999;
    const maxLeft = dir.x < -0.12 ? (northOriginScreen.x - sideSafeX) / -dir.x : 9999;
    const maxRight =
      dir.x > 0.12 ? (viewWidth - sideSafeX - northOriginScreen.x) / dir.x : 9999;
    const maxViewportR = Math.max(48, Math.min(maxTop, maxBottom, maxLeft, maxRight));

    let chosenR = Math.min(minOutsideR, maxViewportR);
    // Если из-за сильного приближения поджатие в экран завело бы значок внутрь контура —
    // держим значок строго снаружи контура квартиры!
    if (vertices.length >= 3) {
      const testScreen = {
        x: northOriginScreen.x + dir.x * chosenR,
        y: northOriginScreen.y + dir.y * chosenR,
      };
      const testPlan = xf.screenToPlan(testScreen);
      if (isPointInPolygon(testPlan, vertices)) {
        chosenR = minOutsideR;
      }
    }

    const hx = northOriginScreen.x + dir.x * chosenR;
    const hy = northOriginScreen.y + dir.y * chosenR;

    placedBadges.push({
      x1: hx - boxR - 6,
      y1: hy - boxR - 6,
      x2: hx + boxR + 6,
      y2: hy + boxR + 6,
      kind: 'north',
    });

    northHandleDraw = {
      northOriginScreen,
      dir,
      boxR,
      chosenR,
      hx,
      hy,
      isProminentVerify: showVerifyNorthArrow,
    };
  }

  // 7.2. Подготовка маркера центра квартиры (Брахмабинду)
  let centerDraw = null;
  if (canShowMapLayers && vastuMap.center) {
    const cScreen = xf.planToScreen(vastuMap.center);
    const isClippedByWall = Boolean(
      !vastuMap.centerOutsideOrClipped &&
        vastuMap.brahmastan &&
        vastuMap.brahmastan.wasClipped
    );
    const labelText = vastuMap.centerOutsideOrClipped
      ? CENTER_OUTSIDE_NOTE
      : isClippedByWall && showBrahmastan
        ? BRAHMASTAN_CLIPPED_BADGE
        : showBrahmastan
          ? 'Брахмастан · Центр'
          : 'Центр квартиры';

    const fPx = Math.round((viewWidth < 500 && !isExport ? 10.5 : 11.5) * fontScale);
    ctx.save();
    ctx.font = `600 ${fPx}px Manrope, sans-serif`;
    const lw = Math.min(viewWidth - 20, ctx.measureText(labelText).width + 14 * fontScale);
    ctx.restore();
    const lh = fPx + 8 * fontScale;

    const minY = isExport ? lh * 0.5 + 10 : 54 + lh * 0.5;
    const maxY = viewHeight - (isExport ? lh * 0.5 + 10 : 56 + lh * 0.5);
    const lx = Math.max(lw * 0.5 + 8, Math.min(viewWidth - lw * 0.5 - 8, cScreen.x));
    const ly = Math.max(minY, Math.min(maxY, cScreen.y + 22 * fontScale));

    const cRect = makeRect(lx, ly, lw, lh);
    placedBadges.push({ ...cRect, kind: 'center' });
    centerDraw = { cScreen, labelText, fPx, lw, lh, lx, ly, cRect };
  }

  // 7.3. Подготовка длинных подписей 8 секторов (ТОЛЬКО если включён переключатель «Подписи секторов»)
  const sectorLabelDraws = [];
  if (canShowMapLayers && showSectorLabels && vastuMap.sectors.length > 0) {
    ctx.save();
    const compactMobile = (viewWidth < 520 || viewHeight < 440) && !isExport;

    for (const sector of vastuMap.sectors) {
      if (sector.sharePercent < 1.2) continue;

      const codeFontPx = Math.round((compactMobile ? 11.5 : 13) * fontScale);
      const subFontPx = Math.round(10 * fontScale);
      ctx.font = `600 ${codeFontPx}px Manrope, sans-serif`;
      const titleLine = compactMobile ? sector.code : `${sector.code} · ${sector.name}`;
      const w1 = ctx.measureText(titleLine).width;

      let w2 = 0;
      const showFormulaOnCanvas = isExport || (viewWidth >= 820 && viewHeight >= 520);
      if (showFormulaOnCanvas) {
        ctx.font = `400 ${subFontPx}px Manrope, sans-serif`;
        w2 = ctx.measureText(sector.formula).width;
      }

      const boxW = Math.max(w1, w2) + (compactMobile ? 12 : 16) * fontScale;
      const boxH = showFormulaOnCanvas
        ? codeFontPx + subFontPx + 13 * fontScale
        : codeFontPx + 8 * fontScale;

      const candidatePlanPts = [];
      const hit = sector.axisOuterHit;
      const dir = azimuthToUnitVector(sector.centerPlanDeg);
      const perp = { x: -dir.y, y: dir.x };

      if (hit && hit.dist > 4) {
        const fractions =
          showBrahmastan && !vastuMap.centerOutsideOrClipped
            ? [0.66, 0.76, 0.54, 0.83, 0.45]
            : [0.60, 0.72, 0.48, 0.80, 0.36];
        for (const f of fractions) {
          candidatePlanPts.push({
            x: vastuMap.center.x + dir.x * hit.dist * f,
            y: vastuMap.center.y + dir.y * hit.dist * f,
          });
        }
        const sideStep = hit.dist * 0.14;
        candidatePlanPts.push(
          {
            x: vastuMap.center.x + dir.x * hit.dist * 0.66 + perp.x * sideStep,
            y: vastuMap.center.y + dir.y * hit.dist * 0.66 + perp.y * sideStep,
          },
          {
            x: vastuMap.center.x + dir.x * hit.dist * 0.66 - perp.x * sideStep,
            y: vastuMap.center.y + dir.y * hit.dist * 0.66 - perp.y * sideStep,
          }
        );
      }
      candidatePlanPts.push(sector.labelPoint);

      let chosenScreen = null;
      let chosenRect = null;
      for (const candPlan of candidatePlanPts) {
        if (!candPlan || !isPointInPolygon(candPlan, vastuMap.vertices)) continue;
        const sPt = xf.planToScreen(candPlan);
        const rect = makeRect(sPt.x, sPt.y, boxW, boxH);
        if (!isRectInsideView(rect, viewWidth, viewHeight, 4)) continue;
        if (!hasCollision(rect, 3, true)) {
          chosenScreen = sPt;
          chosenRect = rect;
          break;
        }
      }

      if (!chosenScreen || !chosenRect) continue;
      placedBadges.push({ ...chosenRect, kind: 'sector', code: sector.code });
      sectorLabelDraws.push({
        sector,
        chosenScreen,
        chosenRect,
        boxW,
        boxH,
        codeFontPx,
        subFontPx,
        titleLine,
        showFormulaOnCanvas,
      });
    }
    ctx.restore();
  }

  // 7.4. Подготовка 8 осей по сторонам света (С, СВ, В, ЮВ, Ю, ЮЗ, З, СЗ) от Брахмабинду
  // до контура квартиры и чуть за него, с короткими буквами направлений на внешних концах.
  let placedAxesCount = 0;
  const axesDraws = [];
  const renderedAxes = [];

  if (canShowMapLayers && showAxes && vastuMap.center) {
    const axesSource =
      vastuMap.axes && vastuMap.axes.length > 0
        ? vastuMap.axes
        : computeAxes(vastuMap.vertices, vastuMap.center, northAngleDeg);

    const compactAxis = (viewWidth < 520 || viewHeight < 440) && !isExport;
    const cardinalAxes = axesSource.filter((a) => a.isCardinal);
    const diagonalAxes = axesSource.filter((a) => !a.isCardinal);
    const orderedAxes = [...cardinalAxes, ...diagonalAxes];

    ctx.save();
    for (const axis of orderedAxes) {
      const cScreen = xf.planToScreen(axis.origin);
      const contourScreen = xf.planToScreen(axis.contourPoint);
      const defaultEndScreen = xf.planToScreen(axis.endPoint);
      const screenDeg = normalizeDeg(axis.planDeg + rotationDeg);
      const sDir = azimuthToUnitVector(screenDeg);
      const sPerp = { x: -sDir.y, y: sDir.x };

      const planOverhangPx = distance(contourScreen, defaultEndScreen);
      const minOverhangPx = Math.max(
        planOverhangPx,
        isExport ? 18 : compactAxis ? 8 : 11
      );

      const fontPx = isExport
        ? axis.isCardinal
          ? 20
          : 17
        : compactAxis
          ? axis.isCardinal
            ? 11.5
            : 10
          : axis.isCardinal
            ? 13
            : 11.5;
      const fontWeight = axis.isCardinal ? 700 : 600;
      ctx.font = `${fontWeight} ${fontPx}px Manrope, sans-serif`;
      const textW = ctx.measureText(axis.code).width;
      const padX = isExport
        ? axis.isCardinal
          ? 14
          : 12
        : compactAxis
          ? axis.isCardinal
            ? 8
            : 6.5
          : axis.isCardinal
            ? 10
            : 8.5;
      const padY = isExport
        ? axis.isCardinal
          ? 10
          : 8
        : compactAxis
          ? axis.isCardinal
            ? 5.5
            : 4.5
          : axis.isCardinal
            ? 7
            : 6;
      const boxH = Math.round(fontPx + padY);
      const boxW = Math.round(Math.max(boxH, textW + padX));
      const halfAlongRay = 0.5 * (Math.abs(sDir.x) * boxW + Math.abs(sDir.y) * boxH);

      let chosenBadge = null;
      const skipBadgeBecauseNorthHandle =
        showVerifyNorthArrow && axis.code === 'С';

      if (!skipBadgeBecauseNorthHandle) {
        const baseGap = showPadas
          ? isExport
            ? showPadaScores
              ? 36
              : 32
            : showPadaScores
              ? 28
              : 24
          : Math.max(
              isExport ? 18 : compactAxis ? 8 : 11,
              Math.min(planOverhangPx * 0.9, isExport ? 26 : 15)
            );
        const d0 = baseGap + halfAlongRay;
        const step = isExport ? 14 : 9;

        // 1) Основной ряд строго вдоль луча оси за пределами контура квартиры
        for (let k = 0; k <= 7; k++) {
          const distOff = d0 + k * step;
          const bx = contourScreen.x + sDir.x * distOff;
          const by = contourScreen.y + sDir.y * distOff;
          const rect = makeRect(bx, by, boxW, boxH);
          if (!isRectInsideView(rect, viewWidth, viewHeight, isExport ? 6 : 3)) continue;
          if (!hasCollision(rect, isExport ? 2.5 : 1.5, true)) {
            chosenBadge = { x: bx, y: by, rect, onRay: true, clampedInward: false };
            break;
          }
        }

        // 2) Запасной сдвиг чуть в сторону вдоль внешней границы (если мешает плашка интерфейса)
        if (!chosenBadge) {
          const latSteps = isExport ? [-18, 18, -32, 32, -48, 48] : [-14, 14, -26, 26];
          outerAxisSearch: for (let k = 0; k <= 4; k++) {
            const distOff = d0 + k * step;
            for (const latOff of latSteps) {
              const bx = contourScreen.x + sDir.x * distOff + sPerp.x * latOff;
              const by = contourScreen.y + sDir.y * distOff + sPerp.y * latOff;
              const candPlan = xf.screenToPlan({ x: bx, y: by });
              if (isPointInPolygon(candPlan, vastuMap.vertices)) continue;
              const rect = makeRect(bx, by, boxW, boxH);
              if (!isRectInsideView(rect, viewWidth, viewHeight, isExport ? 6 : 3)) continue;
              if (!hasCollision(rect, isExport ? 2 : 1.5, true)) {
                chosenBadge = { x: bx, y: by, rect, onRay: false, clampedInward: false };
                break outerAxisSearch;
              }
            }
          }
        }

        // 3) На экране при сильном приближении (когда контур ушёл за край холста) — держим букву у края вида на луче
        if (!chosenBadge && !isExport) {
          const safeTop = 52 + boxH * 0.5;
          const safeBottom = viewHeight - 56 - boxH * 0.5;
          const safeLeft = 6 + boxW * 0.5;
          const safeRight = viewWidth - 6 - boxW * 0.5;
          const tTop = sDir.y < -0.08 ? (cScreen.y - safeTop) / -sDir.y : 9999;
          const tBot = sDir.y > 0.08 ? (safeBottom - cScreen.y) / sDir.y : 9999;
          const tLeft = sDir.x < -0.08 ? (cScreen.x - safeLeft) / -sDir.x : 9999;
          const tRight = sDir.x > 0.08 ? (safeRight - cScreen.x) / sDir.x : 9999;
          const maxRayT = Math.min(tTop, tBot, tLeft, tRight);
          for (let m = 0; m <= 3; m++) {
            const t = maxRayT - m * 12;
            if (t < 32 || !Number.isFinite(t)) break;
            const bx = cScreen.x + sDir.x * t;
            const by = cScreen.y + sDir.y * t;
            const rect = makeRect(bx, by, boxW, boxH);
            if (!isRectInsideView(rect, viewWidth, viewHeight, 3)) continue;
            if (!hasCollision(rect, 1.5, true)) {
              chosenBadge = { x: bx, y: by, rect, onRay: true, clampedInward: true };
              break;
            }
          }
        }

        if (chosenBadge) {
          placedAxesCount++;
          placedBadges.push({
            ...chosenBadge.rect,
            kind: 'axis',
            code: axis.code,
          });
        }
      }

      const lineEndScreen =
        chosenBadge && chosenBadge.onRay && !chosenBadge.clampedInward
          ? { x: chosenBadge.x, y: chosenBadge.y }
          : {
              x: contourScreen.x + sDir.x * minOverhangPx,
              y: contourScreen.y + sDir.y * minOverhangPx,
            };

      const lineWidth = isExport
        ? axis.isCardinal
          ? 3.8
          : 2.2
        : axis.isCardinal
          ? 2.6
          : 1.55;
      const haloWidth = isExport
        ? axis.isCardinal
          ? 7.0
          : 4.8
        : axis.isCardinal
          ? 4.6
          : 3.2;

      const drawEntry = {
        axis,
        cScreen,
        contourScreen,
        lineEndScreen,
        lineWidth,
        haloWidth,
        fontPx,
        fontWeight,
        boxW,
        boxH,
        chosenBadge,
      };
      axesDraws.push(drawEntry);
      renderedAxes.push({
        code: axis.code,
        isCardinal: axis.isCardinal,
        azimuthDeg: axis.azimuthDeg,
        planDeg: axis.planDeg,
        screenDeg,
        lineWidth,
        fromScreen: cScreen,
        contourScreen,
        toScreen: lineEndScreen,
        badgeRect: chosenBadge ? chosenBadge.rect : null,
      });
    }
    ctx.restore();
  }

  // 7.5. Подготовка номеров 32 пад по внешнему периметру:
  // - в сохранённой картинке (isExport) размещаются ВСЕ 32 номера без пропусков (компактный шрифт или тонкая выноска при тесноте);
  // - на экране считаем скрытые из-за тесноты номера, чтобы показать подсказку «Приблизьте, чтобы увидеть все номера пад».
  let totalPadasCount = 0;
  let placedPadasCount = 0;
  const padaDraws = [];

  if (canShowMapLayers && showPadas && vastuMap.padaGrid) {
    ctx.save();
    const centerScreen = xf.planToScreen(vastuMap.center);
    const normalFontPx = isExport
      ? showPadaScores
        ? 12
        : 13
      : Math.round(viewWidth < 520 || viewHeight < 440 ? 9.5 : 11);
    const compactFontPx = isExport ? 11 : Math.max(8.5, normalFontPx - 1);

    const prioritySet = new Set([1, 5, 9, 13, 17, 21, 25, 29]);
    const orderedPadas = [
      ...vastuMap.padaGrid.padas.filter((p) => prioritySet.has(p.number)),
      ...vastuMap.padaGrid.padas.filter((p) => !prioritySet.has(p.number)),
    ];

    for (const pada of orderedPadas) {
      if (!pada.outerWallHit) continue;
      totalPadasCount++;

      const wallScreen = xf.planToScreen(pada.outerWallHit);
      const outDir = computeExteriorWallScreenDir(pada, vastuMap, xf);
      const tangDir = { x: -outDir.y, y: outDir.x };
      const rDx = wallScreen.x - centerScreen.x;
      const rDy = wallScreen.y - centerScreen.y;
      const rLen = Math.hypot(rDx, rDy) || 1;
      const rayDir = { x: rDx / rLen, y: rDy / rLen };

      const scoreSuffix = showPadaScores
        ? ` (${pada.score > 0 ? `+${pada.score}` : pada.score})`
        : '';
      const text = `${pada.number}${scoreSuffix}`;

      const measureForFont = (fPx) => {
        ctx.font = `600 ${fPx}px Manrope, sans-serif`;
        const w = ctx.measureText(text).width;
        const padX = isExport ? 8 : 6;
        const padY = isExport ? 6 : 5;
        return {
          fontPx: fPx,
          padW: Math.max(fPx + padX, w + padX + 1),
          padH: fPx + padY,
        };
      };

      const stdDims = measureForFont(normalFontPx);
      const baseOff = isExport
        ? showPadaScores
          ? 20
          : 16
        : showPadaScores
          ? 17
          : 13;

      let chosen = null;

      // Эшелон 1: вплотную к наружной стене без выноски
      const nearCandidates = isExport
        ? [
            [outDir, baseOff, 0],
            [outDir, baseOff + stdDims.padH + 4, 0],
            [outDir, baseOff, -14],
            [outDir, baseOff, 14],
            [rayDir, baseOff + 2, 0],
            [outDir, baseOff + (stdDims.padH + 4) * 2, 0],
            [outDir, baseOff + stdDims.padH + 4, -18],
            [outDir, baseOff + stdDims.padH + 4, 18],
            [rayDir, -baseOff - 2, 0],
          ]
        : [
            [outDir, baseOff, 0],
            [outDir, baseOff + stdDims.padH + 2, 0],
            [outDir, baseOff, -10],
            [outDir, baseOff, 10],
          ];

      for (const [dirVec, distOff, latOff] of nearCandidates) {
        const bx = wallScreen.x + dirVec.x * distOff + tangDir.x * latOff;
        const by = wallScreen.y + dirVec.y * distOff + tangDir.y * latOff;
        const rect = makeRect(bx, by, stdDims.padW, stdDims.padH);
        if (!isRectInsideView(rect, viewWidth, viewHeight, 3)) continue;
        if (!hasCollision(rect, isExport ? 2 : 1.5, true)) {
          chosen = {
            x: bx,
            y: by,
            rect,
            dims: stdDims,
            useLeader: false,
          };
          break;
        }
      }

      // Эшелон 2 (только для экспорта в PNG): ни один из 32 номеров не пропускается —
      // при тесноте во внутреннем углу берём компактный шрифт и аккуратную тонкую выноску
      if (!chosen && isExport) {
        const smallDims = measureForFont(compactFontPx);
        const baseAngle = Math.atan2(outDir.y, outDir.x);
        const angleOffsetsDeg = [
          0, -18, 18, -36, 36, -54, 54, -72, 72, -90, 90, -115, 115, -145, 145, 180,
        ];
        const radii = [38, 56, 76, 96, 118, 142, 168];

        outerSearch: for (const radDist of radii) {
          for (const aDeg of angleOffsetsDeg) {
            const ang = baseAngle + (aDeg * Math.PI) / 180;
            const bx = wallScreen.x + Math.cos(ang) * radDist;
            const by = wallScreen.y + Math.sin(ang) * radDist;
            const rect = makeRect(bx, by, smallDims.padW, smallDims.padH);
            if (!isRectInsideView(rect, viewWidth, viewHeight, 4)) continue;
            if (!hasCollision(rect, 1.5, true)) {
              chosen = {
                x: bx,
                y: by,
                rect,
                dims: smallDims,
                useLeader: radDist >= 34,
              };
              break outerSearch;
            }
          }
        }
      }

      if (!chosen) continue;

      placedPadasCount++;
      placedBadges.push({ ...chosen.rect, kind: 'pada', number: pada.number });
      padaDraws.push({ pada, wallScreen, text, chosen });
    }
    ctx.restore();
  }

  // ============================================================================
  // 7.6. ОТРИСОВКА ЭКРАННЫХ СЛОЁВ ПО ПОРЯДКУ ГЛУБИНЫ:
  //      сначала линии 8 осей, затем маркеры центра, пад и букв направлений поверх линий
  // ============================================================================
  if (axesDraws.length > 0) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.setLineDash([]);

    const diagEntries = axesDraws.filter((d) => !d.axis.isCardinal);
    const cardEntries = axesDraws.filter((d) => d.axis.isCardinal);

    // Сначала диагональные оси (тоньше), затем главные оси С–Ю и В–З (толще)
    for (const group of [diagEntries, cardEntries]) {
      for (const item of group) {
        ctx.strokeStyle = item.axis.isCardinal
          ? 'rgba(250, 248, 244, 0.92)'
          : 'rgba(250, 248, 244, 0.88)';
        ctx.lineWidth = item.haloWidth;
        ctx.beginPath();
        ctx.moveTo(item.cScreen.x, item.cScreen.y);
        ctx.lineTo(item.lineEndScreen.x, item.lineEndScreen.y);
        ctx.stroke();

        ctx.strokeStyle = '#422326';
        ctx.lineWidth = item.lineWidth;
        ctx.beginPath();
        ctx.moveTo(item.cScreen.x, item.cScreen.y);
        ctx.lineTo(item.lineEndScreen.x, item.lineEndScreen.y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // Стрелка проверки Севера «С» после расчёта по спутнику (не крутится вручную)
  if (northHandleDraw) {
    const { northOriginScreen, dir, boxR, hx, hy, isProminentVerify } = northHandleDraw;
    ctx.save();
    if (isProminentVerify) {
      ctx.strokeStyle = 'rgba(250, 248, 244, 0.88)';
      ctx.lineWidth = 4.4;
      ctx.beginPath();
      ctx.moveTo(northOriginScreen.x, northOriginScreen.y);
      ctx.lineTo(hx, hy);
      ctx.stroke();

      ctx.strokeStyle = '#422326';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(northOriginScreen.x, northOriginScreen.y);
      ctx.lineTo(hx, hy);
      ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(66, 35, 38, 0.45)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(hx - dir.x * 20, hy - dir.y * 20);
      ctx.lineTo(hx, hy);
      ctx.stroke();
    }

    ctx.fillStyle = '#422326';
    ctx.fillRect(hx - boxR, hy - boxR, boxR * 2, boxR * 2);
    ctx.strokeStyle = '#CABC90';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(hx - boxR, hy - boxR, boxR * 2, boxR * 2);

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
    ctx.font = `600 ${isProminentVerify ? 13.5 : 11}px Manrope, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('С', hx, hy + 0.5);
    ctx.restore();
  }

  // Маркер центра квартиры (Брахмабинду) поверх схождения осей
  if (centerDraw) {
    const { cScreen, labelText, fPx, lw, lh, lx, ly, cRect } = centerDraw;
    ctx.save();

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

    ctx.fillStyle = 'rgba(66, 35, 38, 0.94)';
    ctx.fillRect(cRect.x1, cRect.y1, lw, lh);
    ctx.strokeStyle = 'rgba(202, 188, 144, 0.62)';
    ctx.lineWidth = 1;
    ctx.strokeRect(cRect.x1, cRect.y1, lw, lh);

    ctx.font = `600 ${fPx}px Manrope, sans-serif`;
    ctx.fillStyle = '#CABC90';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(labelText, lx, ly + 0.5);
    ctx.restore();
  }

  // Номера 32 пад поверх линий осей
  if (padaDraws.length > 0) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const { pada, wallScreen, text, chosen } of padaDraws) {
      if (chosen.useLeader) {
        ctx.save();
        ctx.strokeStyle = 'rgba(66, 35, 38, 0.52)';
        ctx.lineWidth = 1.15;
        ctx.beginPath();
        ctx.moveTo(wallScreen.x, wallScreen.y);
        ctx.lineTo(chosen.x, chosen.y);
        ctx.stroke();

        ctx.fillStyle = '#422326';
        ctx.beginPath();
        ctx.arc(wallScreen.x, wallScreen.y, 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      const isGood = pada.score > 0;
      const bg = showPadaScores && isGood ? '#E4EFEA' : '#FAF8F4';
      const border =
        showPadaScores && isGood ? '#3F6B5B' : 'rgba(66, 35, 38, 0.38)';
      const fg = showPadaScores && isGood ? '#1E3F33' : '#422326';

      ctx.fillStyle = bg;
      ctx.fillRect(
        chosen.rect.x1,
        chosen.rect.y1,
        chosen.dims.padW,
        chosen.dims.padH
      );
      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      ctx.strokeRect(
        chosen.rect.x1,
        chosen.rect.y1,
        chosen.dims.padW,
        chosen.dims.padH
      );

      ctx.font = `600 ${chosen.dims.fontPx}px Manrope, sans-serif`;
      ctx.fillStyle = fg;
      ctx.fillText(text, chosen.x, chosen.y + 0.5);
    }
    ctx.restore();
  }

  // Короткие буквы направлений на внешних концах 8 осей (С, СВ, В, ЮВ, Ю, ЮЗ, З, СЗ)
  if (axesDraws.length > 0) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const item of axesDraws) {
      const { axis, lineEndScreen, fontPx, fontWeight, boxW, boxH, chosenBadge } = item;
      if (!chosenBadge) continue;

      if (!chosenBadge.onRay) {
        ctx.save();
        ctx.strokeStyle = 'rgba(66, 35, 38, 0.55)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(lineEndScreen.x, lineEndScreen.y);
        ctx.lineTo(chosenBadge.x, chosenBadge.y);
        ctx.stroke();
        ctx.restore();
      }

      const isNorth = axis.code === 'С';
      ctx.fillStyle = isNorth ? '#422326' : '#FAF8F4';
      ctx.fillRect(chosenBadge.rect.x1, chosenBadge.rect.y1, boxW, boxH);

      ctx.strokeStyle = isNorth
        ? '#CABC90'
        : axis.isCardinal
          ? '#422326'
          : 'rgba(66, 35, 38, 0.72)';
      ctx.lineWidth = isNorth
        ? isExport
          ? 2
          : 1.5
        : axis.isCardinal
          ? isExport
            ? 2.2
            : 1.5
          : isExport
            ? 1.6
            : 1.15;
      ctx.strokeRect(chosenBadge.rect.x1, chosenBadge.rect.y1, boxW, boxH);

      ctx.font = `${fontWeight} ${fontPx}px Manrope, sans-serif`;
      ctx.fillStyle = isNorth ? '#CABC90' : '#422326';
      ctx.fillText(axis.code, chosenBadge.x, chosenBadge.y + 0.5);
    }
    ctx.restore();
  }

  // Длинные подписи 8 секторов поверх плана (только когда включён «Подписи секторов»)
  if (sectorLabelDraws.length > 0) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const item of sectorLabelDraws) {
      const {
        sector,
        chosenScreen,
        chosenRect,
        boxW,
        boxH,
        codeFontPx,
        subFontPx,
        titleLine,
        showFormulaOnCanvas,
      } = item;

      ctx.fillStyle = 'rgba(250, 248, 244, 0.92)';
      ctx.fillRect(chosenRect.x1, chosenRect.y1, boxW, boxH);

      ctx.fillStyle = sector.fillColor;
      ctx.fillRect(chosenRect.x1, chosenRect.y1, 4 * fontScale, boxH);

      ctx.strokeStyle = 'rgba(66, 35, 38, 0.32)';
      ctx.lineWidth = 1;
      ctx.strokeRect(chosenRect.x1, chosenRect.y1, boxW, boxH);

      ctx.fillStyle = '#422326';
      ctx.font = `600 ${codeFontPx}px Manrope, sans-serif`;
      if (showFormulaOnCanvas) {
        ctx.fillText(
          titleLine,
          chosenScreen.x + 1.5 * fontScale,
          chosenScreen.y - subFontPx * 0.52
        );
        ctx.fillStyle = '#5D4B4E';
        ctx.font = `400 ${subFontPx}px Manrope, sans-serif`;
        ctx.fillText(
          sector.formula,
          chosenScreen.x + 1.5 * fontScale,
          chosenScreen.y + codeFontPx * 0.52
        );
      } else {
        ctx.fillText(titleLine, chosenScreen.x + 1.5 * fontScale, chosenScreen.y + 0.5);
      }
    }
    ctx.restore();
  }

  // 7.7. Интерактивные вершины и середины стен (во вкладке контура, всегда поверх любых подписей)
  if (!isExport && vertices.length > 0 && activeTab === 'contour') {
    ctx.save();

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

  ctx.restore();
  return {
    transform: xf,
    northHandleScreen,
    placedBadges,
    placedAxesCount,
    renderedAxes,
    totalPadasCount,
    placedPadasCount,
    hiddenPadasCount: Math.max(0, totalPadasCount - placedPadasCount),
    isSatelliteView: false,
  };
}

/**
 * Формирует итоговый лист PNG высокого качества для прикрепления к домашнему заданию.
 * По умолчанию — Север сверху («Север на карте всегда сверху»), вариант «как на листе плана» — по настройке.
 */
export function exportMapToPngCanvas(state) {
  const {
    planCanvas,
    planWidth,
    planHeight,
    northSet = false,
    northAngleDeg = null,
    alignNorthUp = true,
    layers = {},
    vastuMap = null,
  } = state;

  if (!planCanvas || !northSet || !Number.isFinite(northAngleDeg) || !vastuMap || vastuMap.selfIntersects) {
    return null;
  }

  const outWidth = 2400;
  const headerH = 128;
  const showLegend = Boolean(layers.showSectors || layers.showBrahmastan);
  const footerH = showLegend ? 210 : 92;
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

  ctx.fillStyle = '#CABC90';
  ctx.font = '600 44px Cormorant, Georgia, serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('ВАСТУ-КАРТА ПРОСТРАНСТВА', 64, headerH * 0.5);

  const isBrahmastanWallClipped = Boolean(
    !vastuMap.centerOutsideOrClipped &&
      vastuMap.brahmastan &&
      vastuMap.brahmastan.wasClipped
  );

  const activeLayerNames = [];
  if (layers.showSectors) activeLayerNames.push('8 секторов');
  if (layers.showBrahmastan && !vastuMap.centerOutsideOrClipped) {
    activeLayerNames.push(
      isBrahmastanWallClipped
        ? BRAHMASTAN_CLIPPED_BADGE
        : 'Брахмастан по форме квартиры'
    );
  }
  if (layers.showPadas) activeLayerNames.push('Сетка 32 пад');

  ctx.font = '500 21px Manrope, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(202, 188, 144, 0.88)';
  const orientLabel = alignNorthUp ? 'Север сверху' : 'Как на листе плана';
  const headerSubtitle =
    activeLayerNames.length > 0
      ? `${activeLayerNames.join(' · ')}   |   ${orientLabel}`
      : orientLabel;
  ctx.fillText(headerSubtitle, outWidth - 64, headerH * 0.5);

  const rotRad = alignNorthUp ? (-normalizeDeg(northAngleDeg) * Math.PI) / 180 : 0;
  const absCos = Math.abs(Math.cos(rotRad));
  const absSin = Math.abs(Math.sin(rotRad));
  const rotatedW = planWidth * absCos + planHeight * absSin;
  const rotatedH = planWidth * absSin + planHeight * absCos;

  const padMargin = 156;
  const fitZoom = Math.min(
    (outWidth - padMargin * 2) / Math.max(1, rotatedW),
    (mapStageH - padMargin * 2) / Math.max(1, rotatedH)
  );

  const stageCanvas = document.createElement('canvas');
  stageCanvas.width = outWidth;
  stageCanvas.height = mapStageH;
  const stageCtx = stageCanvas.getContext('2d');

  // Резервируем правый верхний угол поля под розу Севера, чтобы подписи пад не заходили под неё
  const roseStageRect = {
    x1: outWidth - 186,
    y1: 42,
    x2: outWidth - 42,
    y2: 186,
  };

  const exportRenderMeta = renderScene(
    stageCtx,
    {
      ...state,
      activeTab: 'layers',
      frozenRotationDeg: null,
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
      extraBlockedRects: [roseStageRect],
    }
  );

  ctx.drawImage(stageCanvas, 0, headerH);

  // Стрелка Севера в правом верхнем углу поля карты: буква «С» строго у острия стрелки!
  const roseX = outWidth - 114;
  const roseY = headerH + 114;
  const effectiveNorthDeg = alignNorthUp ? 0 : normalizeDeg(northAngleDeg);
  const nDir = azimuthToUnitVector(effectiveNorthDeg);

  ctx.save();
  ctx.fillStyle = '#FAF8F4';
  ctx.strokeStyle = 'rgba(66, 35, 38, 0.30)';
  ctx.lineWidth = 2;
  ctx.fillRect(roseX - 64, roseY - 64, 128, 128);
  ctx.strokeRect(roseX - 64, roseY - 64, 128, 128);

  // Древко стрелки от хвоста (-36) к основанию острия (+10)
  ctx.strokeStyle = '#422326';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(roseX - nDir.x * 36, roseY - nDir.y * 36);
  ctx.lineTo(roseX + nDir.x * 12, roseY + nDir.y * 12);
  ctx.stroke();

  // Маленькая засечка на хвосте стрелки
  const pX = -nDir.y;
  const pY = nDir.x;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(roseX - nDir.x * 36 - pX * 6, roseY - nDir.y * 36 - pY * 6);
  ctx.lineTo(roseX - nDir.x * 36 + pX * 6, roseY - nDir.y * 36 + pY * 6);
  ctx.stroke();

  // Остриё стрелки (+26)
  ctx.fillStyle = '#422326';
  ctx.beginPath();
  ctx.moveTo(roseX + nDir.x * 26, roseY + nDir.y * 26);
  ctx.lineTo(roseX + nDir.x * 7 + pX * 9, roseY + nDir.y * 7 + pY * 9);
  ctx.lineTo(roseX + nDir.x * 7 - pX * 9, roseY + nDir.y * 7 - pY * 9);
  ctx.closePath();
  ctx.fill();

  // Буква «С» у острия стрелки (+44 в направлении Севера)
  ctx.font = '700 22px Manrope, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('С', roseX + nDir.x * 44, roseY + nDir.y * 44);
  ctx.restore();

  const footerTop = headerH + mapStageH;
  ctx.strokeStyle = 'rgba(66, 35, 38, 0.18)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(64, footerTop);
  ctx.lineTo(outWidth - 64, footerTop);
  ctx.stroke();

  // Легенда 8 секторов (без процентов площади — чтобы не вводить в заблуждение)
  if (showLegend) {
    const items = (vastuMap.sectors.length > 0 ? vastuMap.sectors : SECTORS).map((s) => ({
      code: s.code,
      name: s.name,
      formula: s.formula,
      color: s.fillColor,
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
      ctx.fillText(`${item.code} · ${item.name}`, x + 40, y - 6);

      ctx.fillStyle = '#6E5A5D';
      ctx.font = '400 16px Manrope, sans-serif';
      ctx.fillText(item.formula, x + 40, y + 16);
    });
  }

  const sigY = outHeight - 32;
  ctx.fillStyle = '#76643A';
  ctx.font = '500 19px Manrope, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText('Васту-карта · Анна Ромео', outWidth - 64, sigY);

  ctx.textAlign = 'left';
  if (vastuMap.centerOutsideOrClipped) {
    ctx.fillStyle = '#422326';
    ctx.font = '600 18px Manrope, sans-serif';
    ctx.fillText(CENTER_OUTSIDE_NOTE, 64, sigY);
  } else if (isBrahmastanWallClipped) {
    ctx.fillStyle = '#422326';
    ctx.font = '500 17px Manrope, sans-serif';
    ctx.fillText(BRAHMASTAN_CLIPPED_NOTE, 64, sigY);
  } else if (layers.showBrahmastan) {
    ctx.fillStyle = '#6E5A5D';
    ctx.font = '400 17px Manrope, sans-serif';
    ctx.fillText(
      'Брахмастан по форме квартиры · Метод школы С. А. Балуты',
      64,
      sigY
    );
  }

  canvas.__exportRenderMeta = exportRenderMeta;
  return canvas;
}
