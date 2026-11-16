/**
 * Чистые вспомогательные функции состояния:
 * - раздельная история «Отменить» (правки контура трогают только углы контура, поворот листа возвращает лист, контур и Север вместе);
 * - проверка минимальной экранной длины стены на спутнике и плане (~100 px);
 * - порог настоящего поворота стрелки «С» (> 3°);
 * - классификация касаний на коротких стенах и безопасное выравнивание 90° без схлопывания углов;
 * - строка поворота дома относительно сторон света (±45° по модулю 90°);
 * - определение способа сохранения (Android — скачивание файла + отдельная кнопка «Поделиться», iPhone — системное меню).
 */

import { normalizeDeg, distance } from './geometry.js';

export const MIN_WALL_SEGMENT_SCREEN_PX = 100;
export const MIN_NORTH_HANDLE_TURN_DEG = 3;
export const MIN_NEW_CORNER_DIST_PX = 11;
export const VERTEX_DRAG_START_PX = 5;

export function clonePointList(pts) {
  if (!Array.isArray(pts)) return [];
  return pts.map((p) => ({ x: p.x, y: p.y }));
}

/**
 * Поворачивает список точек плана на 90° по часовой стрелке для листа с прежней высотой oldHeight.
 */
export function rotatePoints90CW(points, oldHeight) {
  return clonePointList(points).map((p) => ({
    x: oldHeight - p.y,
    y: p.x,
  }));
}

/**
 * Применяет поворот листа на 90° по часовой стрелке ко всем связанным данным
 * (размерам листа, контуру квартиры, опорным точкам плана и направлению Севера, если оно задано).
 */
export function applySheetRotation90CW(current) {
  const oldWidth = current.planWidth;
  const oldHeight = current.planHeight;
  const nextTurns = (((current.sheetQuarterTurns || 0) + 1) % 4 + 4) % 4;
  const hasNorth = Boolean(current.northSet && Number.isFinite(current.northAngleDeg));

  return {
    sheetQuarterTurns: nextTurns,
    planWidth: oldHeight,
    planHeight: oldWidth,
    vertices: rotatePoints90CW(current.vertices || [], oldHeight),
    satPlanPts: rotatePoints90CW(current.satPlanPts || [], oldHeight),
    northSet: hasNorth,
    northAngleDeg: hasNorth ? normalizeDeg(current.northAngleDeg + 90) : null,
  };
}

/**
 * Создаёт стек истории «Отменить» с двумя типами записей:
 * - 'contour' — сохраняет и отменяет ТОЛЬКО углы контура (Север и точки стены не затрагиваются);
 * - 'sheet-rotate' — сохраняет и отменяет поворот листа, размеры, контур, точки плана и Север вместе.
 */
export function createUndoHistory(maxEntries = 40) {
  const stack = [];

  function pushRaw(entry) {
    stack.push(entry);
    if (stack.length > maxEntries) {
      stack.shift();
    }
  }

  function serializeSheetRotate(s) {
    return {
      kind: 'sheet-rotate',
      sheetQuarterTurns: s.sheetQuarterTurns || 0,
      planWidth: s.planWidth || 0,
      planHeight: s.planHeight || 0,
      vertices: clonePointList(s.vertices || []),
      satPlanPts: clonePointList(s.satPlanPts || []),
      northSet: Boolean(s.northSet),
      northAngleDeg:
        s.northSet && Number.isFinite(s.northAngleDeg)
          ? normalizeDeg(s.northAngleDeg)
          : null,
    };
  }

  function serializeContour(verticesOrState) {
    const verts = Array.isArray(verticesOrState)
      ? verticesOrState
      : verticesOrState?.vertices || [];
    return {
      kind: 'contour',
      vertices: clonePointList(verts),
    };
  }

  return {
    pushContour(verticesOrState) {
      pushRaw(serializeContour(verticesOrState));
    },
    pushSheetRotate(state) {
      pushRaw(serializeSheetRotate(state));
    },
    push(state) {
      if (state && state.kind === 'contour') {
        pushRaw(serializeContour(state));
      } else {
        pushRaw(serializeSheetRotate(state));
      }
    },
    pop() {
      if (stack.length === 0) return null;
      return stack.pop();
    },
    clear() {
      stack.length = 0;
    },
    get length() {
      return stack.length;
    },
  };
}

/**
 * Применяет извлечённую запись истории «Отменить» к текущему состоянию:
 * - при kind === 'contour' меняются ТОЛЬКО vertices; Север, точки стены и поворот листа остаются прежними;
 * - при kind === 'sheet-rotate' возвращаются лист, размеры, контур, точки стены на плане и Север вместе.
 */
export function applyUndoEntry(current, entry) {
  if (!entry) return null;

  if (entry.kind === 'contour') {
    return {
      kind: 'contour',
      turnsChanged: false,
      sheetQuarterTurns: current.sheetQuarterTurns || 0,
      planWidth: current.planWidth || 0,
      planHeight: current.planHeight || 0,
      vertices: clonePointList(entry.vertices),
      satPlanPts: clonePointList(current.satPlanPts || []),
      satSatPts: clonePointList(current.satSatPts || []),
      northSet: Boolean(current.northSet),
      northAngleDeg:
        current.northSet && Number.isFinite(current.northAngleDeg)
          ? normalizeDeg(current.northAngleDeg)
          : null,
    };
  }

  const turnsChanged = entry.sheetQuarterTurns !== (current.sheetQuarterTurns || 0);
  return {
    kind: 'sheet-rotate',
    turnsChanged,
    sheetQuarterTurns: entry.sheetQuarterTurns || 0,
    planWidth: entry.planWidth || 0,
    planHeight: entry.planHeight || 0,
    vertices: clonePointList(entry.vertices || []),
    satPlanPts: clonePointList(entry.satPlanPts || []),
    satSatPts: clonePointList(current.satSatPts || []),
    northSet: Boolean(entry.northSet),
    northAngleDeg:
      entry.northSet && Number.isFinite(entry.northAngleDeg)
        ? normalizeDeg(entry.northAngleDeg)
        : null,
  };
}

/**
 * Пункт 2: вычисляет экранный угол поворота плана (в градусах).
 * - На шаге «2. На плане» (satViewMode === 'plan-pick') лист не повёрнут (0°), чтобы удобно ставить и править точки 1 и 2.
 * - Во время любого перетаскивания (frozenRotationDeg числовой) угол экрана заморожен на всё время жеста.
 * - В обычном виде при alignNorthUp и заданном Севере план повёрнут на -northAngleDeg.
 */
export function computePlanViewRotationDeg({
  isExport = false,
  activeTab = 'layers',
  satViewMode = 'idle',
  northSet = false,
  northAngleDeg = null,
  alignNorthUp = true,
  frozenRotationDeg = null,
} = {}) {
  if (!isExport && activeTab === 'plan' && satViewMode === 'plan-pick') {
    return 0;
  }
  if (!isExport && frozenRotationDeg !== null && Number.isFinite(frozenRotationDeg)) {
    return Object.is(frozenRotationDeg, -0) ? 0 : frozenRotationDeg;
  }
  if (northSet && Number.isFinite(northAngleDeg) && alignNorthUp) {
    const rot = -normalizeDeg(northAngleDeg);
    return Object.is(rot, -0) ? 0 : rot;
  }
  return 0;
}

/**
 * Пункт 2: выбирает цель касания во вкладке «План и север»:
 * - «С» всегда проверяется раньше любых маркеров стены;
 * - точки «1» и «2» на плане можно перетаскивать ТОЛЬКО во вкладке «2. На плане» (satViewMode === 'plan-pick');
 *   в виде «Проверка «С»» (satViewMode === 'done') они только для показа!
 */
export function resolvePlanTabHitAction({
  hitNorthHandle = false,
  satViewMode = 'idle',
  hitPlanWallPointIndex = -1,
} = {}) {
  if (hitNorthHandle) {
    return { action: 'rotate-north', pointIndex: -1 };
  }
  if (satViewMode === 'plan-pick' && hitPlanWallPointIndex >= 0) {
    return { action: 'drag-plan-wall-pt', pointIndex: hitPlanWallPointIndex };
  }
  return { action: 'pan-or-tap', pointIndex: -1 };
}

/**
 * Проверяет, что отмеченный на экране отрезок стены не короче minPx экранных пикселей (~100 px),
 * чтобы погрешность пальца не давала ошибку Севера в целую паду.
 */
export function isWallSegmentLongEnoughOnScreen(
  screenPt1,
  screenPt2,
  minPx = MIN_WALL_SEGMENT_SCREEN_PX
) {
  if (!screenPt1 || !screenPt2) return false;
  if (
    !Number.isFinite(screenPt1.x) ||
    !Number.isFinite(screenPt1.y) ||
    !Number.isFinite(screenPt2.x) ||
    !Number.isFinite(screenPt2.y)
  ) {
    return false;
  }
  return distance(screenPt1, screenPt2) >= minPx;
}

/**
 * Когда Север ещё не задан, касание стрелки «С» делает Север заданным только после настоящего поворота (> 3°).
 */
export function shouldCommitNorthHandleTurn({
  wasNorthSet = false,
  maxAbsDeltaDeg = 0,
} = {}) {
  if (wasNorthSet) return true;
  return Number(maxAbsDeltaDeg) > MIN_NORTH_HANDLE_TURN_DEG;
}

/**
 * Классифицирует одиночное касание (без перетаскивания) во вкладке «Контур стен»:
 * если касание дальше minDistPx (11 px) от всех существующих углов — добавляется новый угол;
 * если ближе — дубликат не ставится, выводится подсказка приблизить план.
 */
export function classifyContourTapProximity(
  screenPt,
  vertexScreenPts,
  minDistPx = MIN_NEW_CORNER_DIST_PX
) {
  if (!Array.isArray(vertexScreenPts) || vertexScreenPts.length === 0) {
    return { action: 'add', nearestIndex: -1, dist: Infinity };
  }

  let nearestIndex = -1;
  let bestDist = Infinity;
  for (let i = 0; i < vertexScreenPts.length; i++) {
    const d = distance(screenPt, vertexScreenPts[i]);
    if (d < bestDist) {
      bestDist = d;
      nearestIndex = i;
    }
  }

  if (bestDist <= minDistPx) {
    return { action: 'too-close', nearestIndex, dist: bestDist };
  }
  return { action: 'add', nearestIndex, dist: bestDist };
}

/**
 * Помощник прямого угла 90°: выравнивает точку только по перпендикулярной отклоняющейся оси
 * и никогда не схлопывает короткую стену (например, торец лоджии 12–20 px) в соседний угол.
 */
export function applyOrthoSnapPoint(
  planPt,
  referencePoints,
  zoom = 1,
  enabled = true
) {
  if (!enabled || !Array.isArray(referencePoints) || referencePoints.length === 0) {
    return { x: planPt.x, y: planPt.y };
  }

  const effZoom = Math.max(0.15, Number(zoom) || 1);
  const snapDistPlan = 8 / effZoom;
  const minWallLenPlan = 9 / effZoom;

  let snappedX = planPt.x;
  let snappedY = planPt.y;
  let bestDx = snapDistPlan;
  let bestDy = snapDistPlan;

  for (const ref of referencePoints) {
    if (!ref || !Number.isFinite(ref.x) || !Number.isFinite(ref.y)) continue;
    const dx = Math.abs(planPt.x - ref.x);
    const dy = Math.abs(planPt.y - ref.y);

    // Стена идёт преимущественно вертикально -> выравниваем X, сохраняя длину по Y
    if (dx < dy && dx < bestDx && dy >= minWallLenPlan) {
      bestDx = dx;
      snappedX = ref.x;
    }
    // Стена идёт преимущественно горизонтально -> выравниваем Y, сохраняя длину по X
    else if (dy < dx && dy < bestDy && dx >= minWallLenPlan) {
      bestDy = dy;
      snappedY = ref.y;
    }
  }

  const candidate = { x: snappedX, y: snappedY };
  for (const ref of referencePoints) {
    if (!ref) continue;
    if (distance(candidate, ref) < minWallLenPlan * 0.85) {
      return { x: planPt.x, y: planPt.y };
    }
  }
  return candidate;
}

/**
 * Форматирует строку угла поворота дома относительно сторон света (в пределах ±45°).
 */
export function formatHouseTiltLine(tiltDeg) {
  if (!Number.isFinite(tiltDeg)) return '';
  const rounded = Math.round(tiltDeg * 10) / 10;
  if (Math.abs(rounded) < 0.05) {
    return 'Дом повёрнут на 0° относительно сторон света';
  }
  const absStr = String(Math.abs(rounded)).replace('.', ',');
  const sign = rounded < 0 ? '−' : '';
  return `Дом повёрнут на ${sign}${absStr}° относительно сторон света`;
}

/**
 * Различает iOS, Android, встроенные браузеры мессенджеров и настольные браузеры для выбора способа сохранения.
 */
export function detectExportPlatform({
  userAgent = '',
  platform = '',
  maxTouchPoints = 0,
} = {}) {
  const ua = String(userAgent || '');
  const plat = String(platform || '');
  const isEmbeddedMessenger =
    /Telegram|Instagram|VKAndroidApp|VKClient|\bVK\/|FBAN|FBAV|Line\//i.test(ua);
  const isAndroid = /Android/i.test(ua);
  const isIOS =
    !isAndroid &&
    (/iPhone|iPad|iPod/i.test(ua) ||
      (/Mac/i.test(plat) && Number(maxTouchPoints) > 1));

  return {
    isIOS,
    isAndroid,
    isEmbeddedMessenger,
    // На iPhone системный лист Поделиться содержит «Сохранить изображение» в Фото;
    // на Android «Скачать карту» скачивает файл напрямую, а «Поделиться» вынесена отдельной кнопкой.
    preferShareSheetOnDownload: isIOS && !isEmbeddedMessenger,
  };
}

/**
 * Имя файла сохраняемой карты: karta-kvartiry-ГГГГ-ММ-ДД.png
 */
export function buildExportFilename(date = new Date()) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const yyyy = String(d.getFullYear()).padStart(4, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `karta-kvartiry-${yyyy}-${mm}-${dd}.png`;
}

/**
 * Проверяет ввод градусов Севера: допускается пустая строка во время набора
 * либо число строго в пределах [0, 360] (с точкой или запятой, без знаков + / - / e).
 */
export function validateNorthDegreeInput(rawText) {
  const str = String(rawText ?? '').trim();
  if (str === '') {
    return { ok: true, empty: true, value: null };
  }
  if (!/^\d+(?:[.,]\d*)?$/.test(str)) {
    return { ok: false, empty: false, value: null };
  }
  const normalized = str.replace(',', '.');
  const num = Number(normalized);
  if (!Number.isFinite(num) || num < 0 || num > 360) {
    return { ok: false, empty: false, value: null };
  }
  return { ok: true, empty: false, value: num };
}

/**
 * Разрешено ли сохранять готовую карту (нужны и замкнутый контур без самопересечений, и заданный Север).
 */
export function canExportVastuMap(state) {
  if (!state || !state.planCanvas) return false;
  if (!state.northSet || !Number.isFinite(state.northAngleDeg)) return false;
  if (!Array.isArray(state.vertices) || state.vertices.length < 3) return false;
  if (!state.vastuMap || state.vastuMap.selfIntersects) return false;
  return true;
}

/**
 * Настройки слоёв карты по умолчанию:
 * - сектора, оси и Брахмастан включены;
 * - длинные подписи секторов (названия и формулы поверх плана) по умолчанию ВЫКЛЮЧЕНЫ;
 * - сетка пад и её подпункты по умолчанию выключены.
 */
export function createDefaultLayers() {
  return {
    showSectors: true,
    showSectorLabels: false,
    showAxes: true,
    showBrahmastan: true,
    showPadas: false,
    showPadaBelts: false,
    showPadaScores: false,
    sectorOpacity: 0.4,
  };
}

/**
 * Восстанавливает настройки слоёв из сохранённого черновика (включая переключатель «Подписи секторов»).
 */
export function restoreSavedLayers(savedLayers) {
  const defaults = createDefaultLayers();
  if (!savedLayers || typeof savedLayers !== 'object') {
    return defaults;
  }
  return {
    showSectors: Boolean(savedLayers.showSectors ?? defaults.showSectors),
    showSectorLabels: Boolean(
      savedLayers.showSectorLabels ?? defaults.showSectorLabels
    ),
    showAxes: Boolean(savedLayers.showAxes ?? defaults.showAxes),
    showBrahmastan: Boolean(savedLayers.showBrahmastan ?? defaults.showBrahmastan),
    showPadas: Boolean(savedLayers.showPadas ?? defaults.showPadas),
    showPadaBelts: Boolean(savedLayers.showPadaBelts ?? defaults.showPadaBelts),
    showPadaScores: Boolean(savedLayers.showPadaScores ?? defaults.showPadaScores),
    sectorOpacity:
      typeof savedLayers.sectorOpacity === 'number' &&
      Number.isFinite(savedLayers.sectorOpacity)
        ? savedLayers.sectorOpacity
        : defaults.sectorOpacity,
  };
}
