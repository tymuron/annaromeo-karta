/**
 * Чистые вспомогательные функции состояния:
 * - порядок 4 шагов («1. План», «2. Север», «3. Контур стен», «4. Карта»), блокировка шагов 2–4 без плана и отметка завершённых шагов;
 * - раздельная история «Отменить» (правки контура трогают только углы контура, поворот листа возвращает лист, контур и Север вместе);
 * - проверка минимальной экранной длины стены на спутнике и плане (~100 px);
 * - восстановление черновиков (старые черновики с «ручным» Севером открываются без ошибок и просят задать Север по спутнику);
 * - классификация касаний на коротких стенах и безопасное выравнивание 90° без схлопывания углов;
 * - строка поворота дома относительно сторон света (±45° по модулю 90°);
 * - определение способа сохранения (Android — скачивание файла + отдельная кнопка «Поделиться», iPhone — системное меню).
 */

import { normalizeDeg, distance } from './geometry.js';

export const MIN_WALL_SEGMENT_SCREEN_PX = 100;
export const MIN_NEW_CORNER_DIST_PX = 11;
export const VERTEX_DRAG_START_PX = 5;
export const VALID_STEP_TABS = ['plan', 'north', 'contour', 'layers'];
export const STEP_LOCKED_CAPTION = 'сначала шаг 1';

export function clonePointList(pts) {
  if (!Array.isArray(pts)) return [];
  return pts.map((p) => ({ x: p.x, y: p.y }));
}

/**
 * Вычисляет доступность, подсветку и завершённость 4 шагов конструктора:
 * 1. План -> 2. Север -> 3. Контур стен -> 4. Карта.
 * Пока плана нет, шаги 2–4 недоступны с подписью «сначала шаг 1».
 */
export function computeStepsState(state = {}) {
  const hasPlan = Boolean(state && state.planCanvas);
  const hasNorth = Boolean(
    hasPlan &&
      state.northSet &&
      (!state.northSource || state.northSource === 'satellite') &&
      Number.isFinite(state.northAngleDeg)
  );
  const hasValidContour = Boolean(
    hasPlan &&
      Array.isArray(state.vertices) &&
      state.vertices.length >= 3 &&
      state.vastuMap &&
      !state.vastuMap.selfIntersects
  );
  const canShowMap = Boolean(hasPlan && hasNorth && hasValidContour);
  const mapCompleted = Boolean(canShowMap && state.mapExported);

  const requestedTab = state && VALID_STEP_TABS.includes(state.activeTab)
    ? state.activeTab
    : 'plan';
  const activeTab = hasPlan ? requestedTab : 'plan';

  const satViewMode = state?.satViewMode || 'idle';
  const isPointPicking = Boolean(
    hasPlan &&
      ((activeTab === 'north' &&
        (satViewMode === 'sat' || satViewMode === 'plan-pick')) ||
        activeTab === 'contour')
  );

  return {
    activeTab,
    hasPlan,
    hasNorth,
    hasValidContour,
    canShowMap,
    isPointPicking,
    showNewMapButton: Boolean(hasPlan && activeTab !== 'plan'),
    steps: [
      {
        id: 'plan',
        number: 1,
        baseTitle: '1. План',
        displayTitle: hasPlan ? '✓ 1. План' : '1. План',
        completed: hasPlan,
        disabled: false,
        lockedCaption: '',
        active: activeTab === 'plan',
      },
      {
        id: 'north',
        number: 2,
        baseTitle: '2. Север',
        displayTitle: hasNorth ? '✓ 2. Север' : '2. Север',
        completed: hasNorth,
        disabled: !hasPlan,
        lockedCaption: hasPlan ? '' : STEP_LOCKED_CAPTION,
        active: activeTab === 'north',
      },
      {
        id: 'contour',
        number: 3,
        baseTitle: '3. Контур стен',
        displayTitle: hasValidContour ? '✓ 3. Контур стен' : '3. Контур стен',
        completed: hasValidContour,
        disabled: !hasPlan,
        lockedCaption: hasPlan ? '' : STEP_LOCKED_CAPTION,
        active: activeTab === 'contour',
      },
      {
        id: 'layers',
        number: 4,
        baseTitle: '4. Карта',
        displayTitle: mapCompleted ? '✓ 4. Карта' : '4. Карта',
        completed: mapCompleted,
        disabled: !hasPlan,
        lockedCaption: hasPlan ? '' : STEP_LOCKED_CAPTION,
        active: activeTab === 'layers',
      },
    ],
  };
}

/**
 * Проверяет и нормализует сохранённый черновик сессии.
 * Север в приложении задаётся ТОЛЬКО по спутнику (northSource === 'satellite').
 * Если открывается старый черновик, где Север был задан запасным («ручным») способом
 * (northSet === true без northSource === 'satellite'), черновик открывается без ошибок,
 * план и контур сохраняются, а ученица переводится на шаг «2. Север» с просьбой задать Север по спутнику.
 */
export function normalizeRestoredDraft(saved) {
  if (!saved || typeof saved !== 'object' || saved.version !== 2) {
    return { hasDraft: false };
  }

  const hasSavedImage = Boolean(
    saved.isSamplePlan ||
      (typeof saved.basePlanDataUrl === 'string' && saved.basePlanDataUrl.length > 0)
  );
  if (!hasSavedImage || !Array.isArray(saved.vertices)) {
    return { hasDraft: false };
  }

  const isSatelliteNorth = Boolean(
    saved.northSource === 'satellite' &&
      saved.northSet &&
      Number.isFinite(saved.northAngleDeg)
  );
  const hadLegacyManualNorth = Boolean(
    saved.northSet && saved.northSource !== 'satellite'
  );

  let activeTab = VALID_STEP_TABS.includes(saved.activeTab)
    ? saved.activeTab
    : 'north';

  if (hadLegacyManualNorth) {
    activeTab = 'north';
  } else if (!isSatelliteNorth && activeTab === 'layers') {
    activeTab = 'north';
  }

  return {
    hasDraft: true,
    isSamplePlan: Boolean(saved.isSamplePlan),
    sampleModified: Boolean(saved.sampleModified),
    planTitle: saved.planTitle || 'План квартиры',
    sheetQuarterTurns: (((saved.sheetQuarterTurns || 0) % 4) + 4) % 4,
    basePlanWidth: saved.basePlanWidth || 0,
    basePlanHeight: saved.basePlanHeight || 0,
    basePlanDataUrl: saved.isSamplePlan ? null : saved.basePlanDataUrl,
    vertices: clonePointList(saved.vertices),
    satPlanPts: isSatelliteNorth ? clonePointList(saved.satPlanPts || []) : [],
    satHouseTiltDeg:
      isSatelliteNorth && Number.isFinite(saved.satHouseTiltDeg)
        ? saved.satHouseTiltDeg
        : null,
    northSet: isSatelliteNorth,
    northSource: isSatelliteNorth ? 'satellite' : null,
    northAngleDeg: isSatelliteNorth ? normalizeDeg(saved.northAngleDeg) : null,
    needsSatelliteNorthPrompt: hadLegacyManualNorth,
    alignNorthUp: typeof saved.alignNorthUp === 'boolean' ? saved.alignNorthUp : true,
    orthoSnap: typeof saved.orthoSnap === 'boolean' ? saved.orthoSnap : true,
    activeTab,
    layers: restoreSavedLayers(saved.layers),
  };
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
    northSource: hasNorth ? current.northSource || 'satellite' : null,
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
    const hasNorth = Boolean(s.northSet && Number.isFinite(s.northAngleDeg));
    return {
      kind: 'sheet-rotate',
      sheetQuarterTurns: s.sheetQuarterTurns || 0,
      planWidth: s.planWidth || 0,
      planHeight: s.planHeight || 0,
      vertices: clonePointList(s.vertices || []),
      satPlanPts: clonePointList(s.satPlanPts || []),
      northSet: hasNorth,
      northSource: hasNorth ? s.northSource || 'satellite' : null,
      northAngleDeg: hasNorth ? normalizeDeg(s.northAngleDeg) : null,
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
    const hasNorth = Boolean(current.northSet && Number.isFinite(current.northAngleDeg));
    return {
      kind: 'contour',
      turnsChanged: false,
      sheetQuarterTurns: current.sheetQuarterTurns || 0,
      planWidth: current.planWidth || 0,
      planHeight: current.planHeight || 0,
      vertices: clonePointList(entry.vertices),
      satPlanPts: clonePointList(current.satPlanPts || []),
      satSatPts: clonePointList(current.satSatPts || []),
      northSet: hasNorth,
      northSource: hasNorth ? current.northSource || 'satellite' : null,
      northAngleDeg: hasNorth ? normalizeDeg(current.northAngleDeg) : null,
    };
  }

  const turnsChanged = entry.sheetQuarterTurns !== (current.sheetQuarterTurns || 0);
  const entryHasNorth = Boolean(entry.northSet && Number.isFinite(entry.northAngleDeg));
  return {
    kind: 'sheet-rotate',
    turnsChanged,
    sheetQuarterTurns: entry.sheetQuarterTurns || 0,
    planWidth: entry.planWidth || 0,
    planHeight: entry.planHeight || 0,
    vertices: clonePointList(entry.vertices || []),
    satPlanPts: clonePointList(entry.satPlanPts || []),
    satSatPts: clonePointList(current.satSatPts || []),
    northSet: entryHasNorth,
    northSource: entryHasNorth ? entry.northSource || 'satellite' : null,
    northAngleDeg: entryHasNorth ? normalizeDeg(entry.northAngleDeg) : null,
  };
}

/**
 * Вычисляет экранный угол поворота плана (в градусах).
 * - На этапе отметки точек стены на плане (satViewMode === 'plan-pick') лист не повёрнут (0°).
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
  if (
    !isExport &&
    (((activeTab === 'north' || activeTab === 'plan') && satViewMode === 'plan-pick') ||
      activeTab === 'contour')
  ) {
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
 * Выбирает цель касания во вкладке «2. Север»:
 * - ручного поворота стрелки «С» НЕТ (Север задаётся только по спутнику);
 * - точки «1» и «2» на плане можно перетаскивать ТОЛЬКО на этапе отметки на плане (satViewMode === 'plan-pick');
 *   в виде «Проверка «С»» (satViewMode === 'done') они только для показа!
 */
export function resolvePlanTabHitAction({
  satViewMode = 'idle',
  hitPlanWallPointIndex = -1,
} = {}) {
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
 * Классифицирует одиночное касание (без перетаскивания) во вкладке «3. Контур стен»:
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
 * Разрешено ли сохранять готовую карту (нужны и замкнутый контур без самопересечений, и Север по спутнику).
 */
export function canExportVastuMap(state) {
  if (!state || !state.planCanvas) return false;
  if (!state.northSet || !Number.isFinite(state.northAngleDeg)) return false;
  if (state.northSource && state.northSource !== 'satellite') return false;
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

/**
 * Полностью сбрасывает рабочее состояние конструктора к пустому Шагу 1 («Новая карта»):
 * очищает план, точки, контур, север, спутник, подписи/слои, масштаб, историю отмены и метаданные.
 */
export function resetWorkspaceState(state) {
  if (!state || typeof state !== 'object') return state;

  state.isSamplePlan = false;
  state.sampleModified = false;
  state.basePlanCanvas = null;
  state.sheetQuarterTurns = 0;

  state.planCanvas = null;
  state.planWidth = 0;
  state.planHeight = 0;
  state.planTitle = '';

  state.vertices = [];
  if (state.undoHistory && typeof state.undoHistory.clear === 'function') {
    state.undoHistory.clear();
  } else {
    state.undoHistory = createUndoHistory(40);
  }
  state.selectedVertexIndex = -1;
  state.hoveredVertexIndex = -1;
  state.hoveredEdgeMidpoint = null;
  state.orthoSnap = true;
  state.contourTransientHint = '';

  state.northSet = false;
  state.northSource = null;
  state.northAngleDeg = null;
  state.legacyManualNorthNotice = false;
  state.alignNorthUp = true;
  state.frozenRotationDeg = null;
  state.activeTab = 'plan';
  state.mapExported = false;

  state.layers = createDefaultLayers();

  if (!state.sat || typeof state.sat !== 'object') {
    state.sat = {};
  }
  state.sat.canvas = null;
  state.sat.width = 0;
  state.sat.height = 0;
  state.sat.title = '';
  state.sat.satPts = [];
  state.sat.planPts = [];
  state.sat.houseTiltDeg = null;

  state.satViewMode = 'idle';
  state.satShortWallWarning = '';
  state.satZoom = 1;
  state.satPanX = 0;
  state.satPanY = 0;

  state.vastuMap = null;

  state.zoom = 1;
  state.panX = 0;
  state.panY = 0;
  state.lastRenderMeta = null;

  return state;
}
