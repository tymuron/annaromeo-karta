/**
 * Главный модуль клиентского приложения «Васту-карта · Анна Ромео».
 * Работает полностью локально в браузере (телефон и компьютер).
 */

import {
  normalizeDeg,
  vectorToAzimuthDeg,
  northAngleFromCompass,
  distance,
  buildVastuMap,
} from './geometry.js';
import { SECTORS } from './vastu-data.js';
import { createSampleFloorPlan } from './sample-plan.js';
import { loadPlanFromFile, rotatePlanCanvas } from './pdf-loader.js';
import { renderScene, exportMapToPngCanvas } from './renderer.js';

const state = {
  planCanvas: null,
  planWidth: 0,
  planHeight: 0,
  planTitle: '',

  vertices: [],
  undoStack: [],
  selectedVertexIndex: -1,
  hoveredVertexIndex: -1,
  hoveredEdgeMidpoint: null,
  orthoSnap: true,

  northAngleDeg: 22,
  alignNorthUp: false,
  activeTab: 'layers',

  layers: {
    showSectors: true,
    showBrahmastan: true,
    showPadas: false,
    showPadaBelts: true,
    showPadaScores: false,
    sectorOpacity: 0.55,
  },

  vastuMap: null,

  // Параметры видового экрана
  zoom: 1,
  panX: 0,
  panY: 0,
  lastRenderMeta: null,
};

// DOM-элементы
const studioShell = document.getElementById('studioShell');
const canvasStage = document.getElementById('canvasStage');
const mapCanvas = document.getElementById('mapCanvas');
const ctx = mapCanvas.getContext('2d');

const statusBanner = document.getElementById('canvasStatusBanner');
const toggleCanvasSizeBtn = document.getElementById('toggleCanvasSizeBtn');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const zoomFitBtn = document.getElementById('zoomFitBtn');

const planFileInput = document.getElementById('planFileInput');
const rotatePlan90Btn = document.getElementById('rotatePlan90Btn');
const loadSampleBtn = document.getElementById('loadSampleBtn');
const currentPlanTitle = document.getElementById('currentPlanTitle');

const northReadoutBadge = document.getElementById('northReadoutBadge');
const northSlider = document.getElementById('northSlider');
const northNumberInput = document.getElementById('northNumberInput');
const wallSelect = document.getElementById('wallSelect');
const compassDegInput = document.getElementById('compassDegInput');
const applyCompassBtn = document.getElementById('applyCompassBtn');

const vertexCountBadge = document.getElementById('vertexCountBadge');
const undoContourBtn = document.getElementById('undoContourBtn');
const deleteVertexBtn = document.getElementById('deleteVertexBtn');
const clearContourBtn = document.getElementById('clearContourBtn');
const orthoSnapToggle = document.getElementById('orthoSnapToggle');
const contourWarningBox = document.getElementById('contourWarningBox');

const toggleSectors = document.getElementById('toggleSectors');
const toggleBrahmastan = document.getElementById('toggleBrahmastan');
const togglePadas = document.getElementById('togglePadas');
const padaSuboptions = document.getElementById('padaSuboptions');
const togglePadaBelts = document.getElementById('togglePadaBelts');
const togglePadaScores = document.getElementById('togglePadaScores');
const toggleAlignNorthUp = document.getElementById('toggleAlignNorthUp');
const sectorOpacitySlider = document.getElementById('sectorOpacitySlider');
const sectorOpacityValue = document.getElementById('sectorOpacityValue');

const centerSummaryText = document.getElementById('centerSummaryText');
const zonesBalanceList = document.getElementById('zonesBalanceList');

const topExportBtn = document.getElementById('topExportBtn');
const exportPngBtn = document.getElementById('exportPngBtn');

const tabButtons = Array.from(document.querySelectorAll('.mode-tab'));
const tabPanes = {
  plan: document.getElementById('panelPlan'),
  contour: document.getElementById('panelContour'),
  layers: document.getElementById('panelLayers'),
};

function pushUndoSnapshot() {
  state.undoStack.push(state.vertices.map((p) => ({ x: p.x, y: p.y })));
  if (state.undoStack.length > 40) {
    state.undoStack.shift();
  }
}

function pluralizeCorners(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} угол`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} угла`;
  return `${count} углов`;
}

function recomputeVastuMap() {
  if (state.vertices.length >= 3) {
    state.vastuMap = buildVastuMap(state.vertices, state.northAngleDeg);
  } else {
    state.vastuMap = null;
  }
  syncInspectorUI();
  requestRender();
}

function fitPlanToViewport() {
  if (!state.planCanvas) return;
  const rect = canvasStage.getBoundingClientRect();
  const vw = Math.max(100, rect.width);
  const vh = Math.max(100, rect.height);

  const rotRad = state.alignNorthUp
    ? (-normalizeDeg(state.northAngleDeg) * Math.PI) / 180
    : 0;
  const absCos = Math.abs(Math.cos(rotRad));
  const absSin = Math.abs(Math.sin(rotRad));
  const effW = state.planWidth * absCos + state.planHeight * absSin;
  const effH = state.planWidth * absSin + state.planHeight * absCos;

  const sidePad = vw < 520 ? 16 : 44;
  const topHudSpace = vw < 520 ? 68 : 54;
  const bottomHudSpace = vw < 520 ? 58 : 54;
  const availW = Math.max(60, vw - sidePad * 2);
  const availH = Math.max(60, vh - topHudSpace - bottomHudSpace);

  state.zoom = Math.min(
    Math.max(0.08, availW / effW),
    Math.max(0.08, availH / effH)
  );
  state.panX = 0;
  state.panY = (topHudSpace - bottomHudSpace) * 0.5;
  requestRender();
}

function zoomByFactor(factor, pivotScreen = null) {
  if (!state.planCanvas || !state.lastRenderMeta) return;
  const rect = canvasStage.getBoundingClientRect();
  const cx = pivotScreen ? pivotScreen.x : rect.width * 0.5;
  const cy = pivotScreen ? pivotScreen.y : rect.height * 0.5;

  const prevZoom = state.zoom;
  const nextZoom = Math.max(0.1, Math.min(6, prevZoom * factor));
  const ratio = nextZoom / prevZoom;

  const dx = cx - rect.width * 0.5 - state.panX;
  const dy = cy - rect.height * 0.5 - state.panY;
  state.panX -= dx * (ratio - 1);
  state.panY -= dy * (ratio - 1);
  state.zoom = nextZoom;
  requestRender();
}

let rafPending = false;
function requestRender() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    drawNow();
  });
}

function drawNow() {
  const rect = canvasStage.getBoundingClientRect();
  const viewWidth = Math.max(1, Math.round(rect.width));
  const viewHeight = Math.max(1, Math.round(rect.height));
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);

  const targetW = Math.round(viewWidth * dpr);
  const targetH = Math.round(viewHeight * dpr);
  if (mapCanvas.width !== targetW || mapCanvas.height !== targetH) {
    mapCanvas.width = targetW;
    mapCanvas.height = targetH;
  }

  state.lastRenderMeta = renderScene(ctx, state, {
    viewWidth,
    viewHeight,
    dpr,
    isExport: false,
  });
}

function setActiveTab(tabName) {
  if (!tabPanes[tabName]) return;
  state.activeTab = tabName;

  for (const btn of tabButtons) {
    const active = btn.dataset.tab === tabName;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  }
  for (const [key, pane] of Object.entries(tabPanes)) {
    const active = key === tabName;
    pane.hidden = !active;
    pane.classList.toggle('is-active', active);
  }

  syncInspectorUI();
  requestRender();
}

function setNorthAngle(deg) {
  state.northAngleDeg = normalizeDeg(deg);
  const roundedDisp = Math.round(state.northAngleDeg * 10) / 10;
  northReadoutBadge.textContent = `${String(roundedDisp).replace('.', ',')}°`;
  northSlider.value = String(Math.round(state.northAngleDeg) % 360);
  if (document.activeElement !== northNumberInput) {
    northNumberInput.value = String(roundedDisp);
  }
  recomputeVastuMap();
}

function syncStatusBanner() {
  if (state.activeTab === 'plan') {
    statusBanner.textContent =
      'Потяните значок «С» на плане или введите градусы с компаса телефона';
    return;
  }

  if (state.activeTab === 'contour') {
    if (state.vertices.length === 0) {
      statusBanner.textContent =
        'Коснитесь внутренних углов квартиры по порядку (от 3 точек)';
    } else if (state.vertices.length < 3) {
      statusBanner.textContent = `Отмечено: ${pluralizeCorners(state.vertices.length)} — добавьте ещё ${3 - state.vertices.length} для замыкания контура`;
    } else if (state.vastuMap && state.vastuMap.selfIntersects) {
      statusBanner.textContent =
        'Линии стен пересекаются: подвиньте угол или нажмите «Отменить»';
    } else {
      statusBanner.textContent = `Контур замкнут (${pluralizeCorners(state.vertices.length)}) · Углы можно двигать`;
    }
    return;
  }

  // Режим «Слои карты»
  if (!state.vastuMap) {
    statusBanner.textContent =
      'Откройте «Контур стен» и отметьте внутренние углы квартиры';
    return;
  }
  const active = [];
  if (state.layers.showSectors) active.push('8 секторов');
  if (state.layers.showBrahmastan) active.push('Брахмастан по форме');
  if (state.layers.showPadas) active.push('Сетка 32 пад');
  statusBanner.textContent =
    active.length > 0
      ? `Карта готова · ${active.join(' · ')}`
      : 'Включите нужные слои карты ниже';
}

function syncInspectorUI() {
  currentPlanTitle.textContent = state.planTitle || 'План квартиры';

  const roundedNorth = Math.round(state.northAngleDeg * 10) / 10;
  northReadoutBadge.textContent = `${String(roundedNorth).replace('.', ',')}°`;
  northSlider.value = String(Math.round(state.northAngleDeg) % 360);
  if (document.activeElement !== northNumberInput) {
    northNumberInput.value = String(roundedNorth);
  }

  vertexCountBadge.textContent = pluralizeCorners(state.vertices.length);
  undoContourBtn.disabled = state.undoStack.length === 0;
  deleteVertexBtn.disabled = state.vertices.length === 0;
  clearContourBtn.disabled = state.vertices.length === 0;

  padaSuboptions.hidden = !state.layers.showPadas;

  // Предупреждения по контуру
  if (state.vastuMap && state.vastuMap.selfIntersects) {
    contourWarningBox.hidden = false;
    contourWarningBox.textContent =
      'Стены пересекают сами себя. Перетащите угловую точку так, чтобы контур шёл по периметру последовательно, или нажмите «Отменить».';
  } else {
    contourWarningBox.hidden = true;
  }

  // Сводка по центру и балансу 8 секторов
  if (!state.vastuMap || state.vastuMap.selfIntersects) {
    centerSummaryText.textContent =
      'Отметьте минимум 3 внутренних угла квартиры во вкладке «Контур стен», чтобы построить центр, сектора и Брахмастан.';
    renderZonesList(null);
  } else {
    const notes = [
      'Центр квартиры (Брахмабинду) рассчитан по настоящей форме контура и отмечен на плане.',
    ];
    if (!state.vastuMap.centerInside) {
      notes.push(
        'В сильно изогнутой планировке геометрический центр оказался за пределами стен — для таких квартир на курсе рекомендуется проверить, не состоит ли жильё из двух отдельных объёмов.'
      );
    }
    if (state.vastuMap.brahmastan && state.vastuMap.brahmastan.wasClipped) {
      notes.push(
        'Часть контура Брахмастана, выходившая за наружную стену, аккуратно отсечена по правилу школы С. А. Балуты.'
      );
    }
    centerSummaryText.textContent = notes.join(' ');
    renderZonesList(state.vastuMap.sectors);
  }

  syncStatusBanner();
}

function renderZonesList(computedSectors) {
  const list = computedSectors || SECTORS;
  zonesBalanceList.innerHTML = '';

  for (const s of list) {
    const card = document.createElement('div');
    card.className = 'zone-card';

    const swatch = document.createElement('div');
    swatch.className = 'zone-swatch';
    swatch.style.backgroundColor = s.fillColor;

    const meta = document.createElement('div');
    meta.className = 'zone-meta';

    const title = document.createElement('div');
    title.className = 'zone-title';
    title.textContent = `${s.code} · ${s.name} (${s.planet})`;

    const formula = document.createElement('div');
    formula.className = 'zone-formula';
    formula.textContent = s.formula;

    meta.appendChild(title);
    meta.appendChild(formula);

    const share = document.createElement('div');
    share.className = 'zone-share';
    share.textContent =
      typeof s.sharePercent === 'number'
        ? `${s.sharePercent.toFixed(1).replace('.', ',')}%`
        : '—';

    card.appendChild(swatch);
    card.appendChild(meta);
    card.appendChild(share);
    zonesBalanceList.appendChild(card);
  }
}

// ============================================================================
// Помощник ортогонального выравнивания (90° к соседним углам)
// ============================================================================
function applyOrthoSnap(planPt, referencePoints) {
  if (!state.orthoSnap || !referencePoints || referencePoints.length === 0) {
    return planPt;
  }
  const snapDistPlan = 13 / Math.max(0.15, state.zoom);
  let snappedX = planPt.x;
  let snappedY = planPt.y;
  let bestDx = snapDistPlan;
  let bestDy = snapDistPlan;

  for (const ref of referencePoints) {
    if (!ref) continue;
    const dx = Math.abs(planPt.x - ref.x);
    const dy = Math.abs(planPt.y - ref.y);
    if (dx < bestDx) {
      bestDx = dx;
      snappedX = ref.x;
    }
    if (dy < bestDy) {
      bestDy = dy;
      snappedY = ref.y;
    }
  }

  return { x: snappedX, y: snappedY };
}

// ============================================================================
// Поиск элементов под пальцем / курсором на холсте
// ============================================================================
function getCanvasLocalPoint(clientX, clientY) {
  const rect = mapCanvas.getBoundingClientRect();
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}

function hitTestNorthHandle(screenPt, isTouch = false) {
  const h = state.lastRenderMeta && state.lastRenderMeta.northHandleScreen;
  if (!h) return false;
  const hitRadius = isTouch ? 30 : 22;
  return Math.hypot(screenPt.x - h.x, screenPt.y - h.y) <= hitRadius;
}

function hitTestVertex(screenPt, isTouch = false) {
  if (!state.lastRenderMeta || state.vertices.length === 0) return -1;
  const xf = state.lastRenderMeta.transform;
  const hitR = isTouch ? 24 : 14;
  let bestIdx = -1;
  let bestDist = hitR;

  for (let i = 0; i < state.vertices.length; i++) {
    const p = xf.planToScreen(state.vertices[i]);
    const d = distance(screenPt, p);
    if (d <= bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function hitTestEdgeMidpoint(screenPt, isTouch = false) {
  if (!state.lastRenderMeta || state.vertices.length < 3) return -1;
  const xf = state.lastRenderMeta.transform;
  const hitR = isTouch ? 22 : 12;
  let bestIdx = -1;
  let bestDist = hitR;

  for (let i = 0; i < state.vertices.length; i++) {
    const a = xf.planToScreen(state.vertices[i]);
    const b = xf.planToScreen(state.vertices[(i + 1) % state.vertices.length]);
    if (distance(a, b) < 38) continue;
    const mid = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
    const d = distance(screenPt, mid);
    if (d <= bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

// ============================================================================
// Обработка касаний (1 палец, 2 пальца pinch-to-zoom) и мыши на чертеже
// ============================================================================
const activePointers = new Map();
let gesture = null;

mapCanvas.addEventListener('pointerdown', (e) => {
  if (!state.planCanvas) return;
  mapCanvas.setPointerCapture(e.pointerId);
  const pt = getCanvasLocalPoint(e.clientX, e.clientY);
  const isTouch = e.pointerType === 'touch';
  activePointers.set(e.pointerId, pt);

  // Два пальца -> масштабирование щипком (pinch-to-zoom) и панорамирование
  if (activePointers.size === 2) {
    const pts = Array.from(activePointers.values());
    const mid = { x: (pts[0].x + pts[1].x) * 0.5, y: (pts[0].y + pts[1].y) * 0.5 };
    gesture = {
      type: 'pinch',
      startDist: Math.max(10, distance(pts[0], pts[1])),
      startZoom: state.zoom,
      lastMid: mid,
    };
    return;
  }

  if (activePointers.size > 2) return;

  // 1. Попадание в ручку стрелки Севера «С» (работает в любой вкладке)
  if (hitTestNorthHandle(pt, isTouch)) {
    const h = state.lastRenderMeta.northHandleScreen;
    gesture = {
      type: 'rotate-north',
      originX: h.originX,
      originY: h.originY,
      startScreenAngle: vectorToAzimuthDeg(pt.x - h.originX, pt.y - h.originY),
      startNorthDeg: state.northAngleDeg,
    };
    return;
  }

  // 2. В режиме «Контур стен»: проверка попадания в угол или середину стены
  if (state.activeTab === 'contour') {
    const vIdx = hitTestVertex(pt, isTouch);
    if (vIdx !== -1) {
      pushUndoSnapshot();
      state.selectedVertexIndex = vIdx;
      gesture = {
        type: 'drag-vertex',
        vertexIndex: vIdx,
      };
      requestRender();
      return;
    }

    const edgeIdx = hitTestEdgeMidpoint(pt, isTouch);
    if (edgeIdx !== -1) {
      pushUndoSnapshot();
      const a = state.vertices[edgeIdx];
      const b = state.vertices[(edgeIdx + 1) % state.vertices.length];
      const inserted = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
      const insertPos = edgeIdx + 1;
      state.vertices.splice(insertPos, 0, inserted);
      state.selectedVertexIndex = insertPos;
      gesture = {
        type: 'drag-vertex',
        vertexIndex: insertPos,
      };
      recomputeVastuMap();
      return;
    }
  }

  // 3. Одиночное нажатие в пустом месте: панорамирование при сдвиге или добавление угла при коротком касании
  gesture = {
    type: 'pan-or-tap',
    startPt: pt,
    lastPt: pt,
    moved: false,
  };
});

mapCanvas.addEventListener('pointermove', (e) => {
  const pt = getCanvasLocalPoint(e.clientX, e.clientY);
  if (activePointers.has(e.pointerId)) {
    activePointers.set(e.pointerId, pt);
  }

  if (!gesture) {
    // Подсветка под курсором мыши
    if (e.pointerType === 'mouse' && state.activeTab === 'contour') {
      const vIdx = hitTestVertex(pt, false);
      const eIdx = vIdx === -1 ? hitTestEdgeMidpoint(pt, false) : -1;
      if (vIdx !== state.hoveredVertexIndex || eIdx !== state.hoveredEdgeMidpoint) {
        state.hoveredVertexIndex = vIdx;
        state.hoveredEdgeMidpoint = eIdx;
        mapCanvas.style.cursor = vIdx !== -1 || eIdx !== -1 ? 'pointer' : 'crosshair';
        requestRender();
      }
    } else if (e.pointerType === 'mouse') {
      mapCanvas.style.cursor = hitTestNorthHandle(pt, false) ? 'pointer' : 'grab';
    }
    return;
  }

  if (gesture.type === 'pinch' && activePointers.size >= 2) {
    const pts = Array.from(activePointers.values());
    const mid = { x: (pts[0].x + pts[1].x) * 0.5, y: (pts[0].y + pts[1].y) * 0.5 };
    const currDist = Math.max(10, distance(pts[0], pts[1]));

    state.panX += mid.x - gesture.lastMid.x;
    state.panY += mid.y - gesture.lastMid.y;

    const targetZoom = Math.max(
      0.1,
      Math.min(6, gesture.startZoom * (currDist / gesture.startDist))
    );
    const factor = targetZoom / state.zoom;
    zoomByFactor(factor, mid);
    gesture.lastMid = mid;
    return;
  }

  if (gesture.type === 'rotate-north') {
    const currAngle = vectorToAzimuthDeg(pt.x - gesture.originX, pt.y - gesture.originY);
    if (state.alignNorthUp) {
      const delta = currAngle - gesture.startScreenAngle;
      setNorthAngle(gesture.startNorthDeg - delta);
    } else {
      setNorthAngle(currAngle);
    }
    return;
  }

  if (gesture.type === 'drag-vertex' && state.lastRenderMeta) {
    const idx = gesture.vertexIndex;
    const rawPlanPt = state.lastRenderMeta.transform.screenToPlan(pt);
    const clampedPt = {
      x: Math.max(0, Math.min(state.planWidth, rawPlanPt.x)),
      y: Math.max(0, Math.min(state.planHeight, rawPlanPt.y)),
    };
    const n = state.vertices.length;
    const refs =
      n >= 2
        ? [
            state.vertices[(idx - 1 + n) % n],
            n >= 3 ? state.vertices[(idx + 1) % n] : null,
          ]
        : [];
    state.vertices[idx] = applyOrthoSnap(clampedPt, refs);
    recomputeVastuMap();
    return;
  }

  if (gesture.type === 'pan-or-tap') {
    const totalMove = distance(pt, gesture.startPt);
    if (totalMove > 6) {
      gesture.moved = true;
    }
    if (gesture.moved) {
      state.panX += pt.x - gesture.lastPt.x;
      state.panY += pt.y - gesture.lastPt.y;
      gesture.lastPt = pt;
      requestRender();
    }
  }
});

function handlePointerUpOrCancel(e) {
  const pt = getCanvasLocalPoint(e.clientX, e.clientY);
  activePointers.delete(e.pointerId);

  if (
    gesture &&
    gesture.type === 'pan-or-tap' &&
    !gesture.moved &&
    state.activeTab === 'contour' &&
    state.lastRenderMeta
  ) {
    // Добавление нового внутреннего угла контура по касанию/клику
    const rawPlanPt = state.lastRenderMeta.transform.screenToPlan(pt);
    if (
      rawPlanPt.x >= -20 &&
      rawPlanPt.x <= state.planWidth + 20 &&
      rawPlanPt.y >= -20 &&
      rawPlanPt.y <= state.planHeight + 20
    ) {
      const clamped = {
        x: Math.max(0, Math.min(state.planWidth, rawPlanPt.x)),
        y: Math.max(0, Math.min(state.planHeight, rawPlanPt.y)),
      };
      pushUndoSnapshot();
      const refs = [];
      if (state.vertices.length >= 1) {
        refs.push(state.vertices[state.vertices.length - 1]);
      }
      if (state.vertices.length >= 2) {
        refs.push(state.vertices[0]);
      }
      const finalPt = applyOrthoSnap(clamped, refs);
      state.vertices.push(finalPt);
      state.selectedVertexIndex = state.vertices.length - 1;
      recomputeVastuMap();
    }
  }

  if (activePointers.size === 0) {
    gesture = null;
  } else if (activePointers.size === 1) {
    const remainingPt = Array.from(activePointers.values())[0];
    gesture = {
      type: 'pan-or-tap',
      startPt: remainingPt,
      lastPt: remainingPt,
      moved: true,
    };
  }
}

mapCanvas.addEventListener('pointerup', handlePointerUpOrCancel);
mapCanvas.addEventListener('pointercancel', handlePointerUpOrCancel);

// Масштабирование колесом мыши / трекпадом на компьютере
mapCanvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const pt = getCanvasLocalPoint(e.clientX, e.clientY);
    const factor = Math.exp(-e.deltaY * 0.0014);
    zoomByFactor(factor, pt);
  },
  { passive: false }
);

// ============================================================================
// Привязка кнопок и переключателей интерфейса
// ============================================================================
for (const btn of tabButtons) {
  btn.addEventListener('click', () => {
    setActiveTab(btn.dataset.tab);
  });
}

zoomInBtn.addEventListener('click', () => zoomByFactor(1.25));
zoomOutBtn.addEventListener('click', () => zoomByFactor(0.8));
zoomFitBtn.addEventListener('click', () => fitPlanToViewport());

toggleCanvasSizeBtn.addEventListener('click', () => {
  const expanded = studioShell.classList.toggle('canvas-expanded');
  toggleCanvasSizeBtn.textContent = expanded ? 'Компактно' : 'Крупнее';
  setTimeout(() => fitPlanToViewport(), 30);
});

// Загрузка собственного плана ученицы (JPG/PNG/WebP/PDF)
planFileInput.addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  statusBanner.textContent = 'Читаем файл плана…';
  try {
    const loaded = await loadPlanFromFile(file);
    state.planCanvas = loaded.canvas;
    state.planWidth = loaded.width;
    state.planHeight = loaded.height;
    state.planTitle = loaded.title;
    state.vertices = [];
    state.undoStack = [];
    state.selectedVertexIndex = -1;
    state.alignNorthUp = false;
    toggleAlignNorthUp.checked = false;

    setActiveTab('plan');
    recomputeVastuMap();
    fitPlanToViewport();
    statusBanner.textContent =
      'План открыт · Задайте Север и перейдите в «Контур стен»';
  } catch (err) {
    statusBanner.textContent =
      err && err.message ? err.message : 'Не удалось открыть файл плана.';
  } finally {
    planFileInput.value = '';
  }
});

// Поворот загруженного листа плана на 90° по часовой стрелке
rotatePlan90Btn.addEventListener('click', () => {
  if (!state.planCanvas) return;
  const oldHeight = state.planHeight;
  const rotated = rotatePlanCanvas(state.planCanvas, 1);

  if (state.vertices.length > 0) {
    pushUndoSnapshot();
    state.vertices = state.vertices.map((p) => ({
      x: oldHeight - p.y,
      y: p.x,
    }));
  }

  state.planCanvas = rotated;
  state.planWidth = rotated.width;
  state.planHeight = rotated.height;
  setNorthAngle(state.northAngleDeg + 90);
  fitPlanToViewport();
});

// Загрузка учебного Г-образного плана
function openSamplePlan() {
  const sample = createSampleFloorPlan();
  state.planCanvas = sample.canvas;
  state.planWidth = sample.width;
  state.planHeight = sample.height;
  state.planTitle = sample.title;
  state.vertices = sample.defaultVertices;
  state.undoStack = [];
  state.selectedVertexIndex = -1;
  state.northAngleDeg = sample.defaultNorthDeg;
  recomputeVastuMap();
  fitPlanToViewport();
}

loadSampleBtn.addEventListener('click', () => {
  openSamplePlan();
});

// Управление направлением на Север
northSlider.addEventListener('input', () => {
  setNorthAngle(Number(northSlider.value));
});

northNumberInput.addEventListener('input', () => {
  const val = parseFloat(northNumberInput.value);
  if (Number.isFinite(val)) {
    setNorthAngle(val);
  }
});

for (const chip of document.querySelectorAll('[data-north]')) {
  chip.addEventListener('click', () => {
    setNorthAngle(Number(chip.getAttribute('data-north')));
  });
}

applyCompassBtn.addEventListener('click', () => {
  const wallDir = Number(wallSelect.value) || 0;
  const compassVal = parseFloat(compassDegInput.value);
  if (!Number.isFinite(compassVal)) {
    compassDegInput.focus();
    return;
  }
  const computedNorth = northAngleFromCompass(compassVal, wallDir);
  setNorthAngle(computedNorth);
});

// Кнопки редактирования контура
undoContourBtn.addEventListener('click', () => {
  if (state.undoStack.length === 0) return;
  state.vertices = state.undoStack.pop();
  state.selectedVertexIndex = Math.min(
    state.selectedVertexIndex,
    state.vertices.length - 1
  );
  recomputeVastuMap();
});

deleteVertexBtn.addEventListener('click', () => {
  if (state.vertices.length === 0) return;
  pushUndoSnapshot();
  const removeIdx =
    state.selectedVertexIndex >= 0 &&
    state.selectedVertexIndex < state.vertices.length
      ? state.selectedVertexIndex
      : state.vertices.length - 1;
  state.vertices.splice(removeIdx, 1);
  state.selectedVertexIndex = Math.min(removeIdx, state.vertices.length - 1);
  recomputeVastuMap();
});

clearContourBtn.addEventListener('click', () => {
  if (state.vertices.length === 0) return;
  pushUndoSnapshot();
  state.vertices = [];
  state.selectedVertexIndex = -1;
  recomputeVastuMap();
});

orthoSnapToggle.addEventListener('change', () => {
  state.orthoSnap = orthoSnapToggle.checked;
});

// Переключатели слоёв по методу школы Балуты
toggleSectors.addEventListener('change', () => {
  state.layers.showSectors = toggleSectors.checked;
  syncInspectorUI();
  requestRender();
});

toggleBrahmastan.addEventListener('change', () => {
  state.layers.showBrahmastan = toggleBrahmastan.checked;
  syncInspectorUI();
  requestRender();
});

togglePadas.addEventListener('change', () => {
  state.layers.showPadas = togglePadas.checked;
  syncInspectorUI();
  requestRender();
});

togglePadaBelts.addEventListener('change', () => {
  state.layers.showPadaBelts = togglePadaBelts.checked;
  requestRender();
});

togglePadaScores.addEventListener('change', () => {
  state.layers.showPadaScores = togglePadaScores.checked;
  requestRender();
});

toggleAlignNorthUp.addEventListener('change', () => {
  state.alignNorthUp = toggleAlignNorthUp.checked;
  fitPlanToViewport();
});

sectorOpacitySlider.addEventListener('input', () => {
  const pct = Number(sectorOpacitySlider.value) || 55;
  sectorOpacityValue.textContent = `${pct}%`;
  state.layers.sectorOpacity = pct / 100;
  requestRender();
});

// Сохранение готовой карты в PNG высокого разрешения
function triggerPngDownload() {
  if (!state.planCanvas) return;
  const exportCanvas = exportMapToPngCanvas(state);
  if (!exportCanvas) return;

  exportCanvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'vastu-karta-anna-romeo.png';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, 'image/png');
}

topExportBtn.addEventListener('click', triggerPngDownload);
exportPngBtn.addEventListener('click', triggerPngDownload);

// Горячая клавиша Ctrl+Z / Cmd+Z для отмены действия в контуре
window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    if (state.undoStack.length > 0 && state.activeTab === 'contour') {
      e.preventDefault();
      undoContourBtn.click();
    }
  }
});

// Отслеживание изменения размеров окна
const resizeObserver = new ResizeObserver(() => {
  fitPlanToViewport();
});
resizeObserver.observe(canvasStage);

// Инициализация
openSamplePlan();
setActiveTab('layers');

if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => {
    openSamplePlan();
  });
}

// Для автотестов и проверки состояния
window.__vastuApp = {
  state,
  setNorthAngle,
  setActiveTab,
  fitPlanToViewport,
  exportMapToPngCanvas: () => exportMapToPngCanvas(state),
};
