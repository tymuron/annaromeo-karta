/**
 * Главный модуль клиентского приложения «Васту-карта · Анна Ромео».
 * Работает локально в браузере на телефоне и компьютере.
 */

import {
  normalizeDeg,
  vectorToAzimuthDeg,
  signedAngleDeltaDeg,
  northAngleFromWallSegments,
  distance,
  buildVastuMap,
  CENTER_OUTSIDE_NOTE,
} from './geometry.js';
import { SECTORS } from './vastu-data.js';
import { createSampleFloorPlan } from './sample-plan.js';
import {
  loadPlanFromFile,
  loadSatelliteFromFile,
  rotatePlanCanvas,
} from './pdf-loader.js';
import { renderScene, exportMapToPngCanvas } from './renderer.js';
import {
  clonePointList,
  applySheetRotation90CW,
  createUndoHistory,
  buildExportFilename,
  validateNorthDegreeInput,
  canExportVastuMap,
} from './state-helpers.js';
import {
  downscalePlanToDataUrl,
  restorePlanCanvasFromDataUrl,
  saveWorkspaceSession,
  loadWorkspaceSession,
} from './storage.js';

const state = {
  isSamplePlan: true,
  sampleModified: false,
  basePlanCanvas: null,
  sheetQuarterTurns: 0,

  planCanvas: null,
  planWidth: 0,
  planHeight: 0,
  planTitle: '',

  vertices: [],
  undoHistory: createUndoHistory(40),
  selectedVertexIndex: -1,
  hoveredVertexIndex: -1,
  hoveredEdgeMidpoint: null,
  orthoSnap: true,

  northSet: true,
  northAngleDeg: 22,
  alignNorthUp: true,
  frozenRotationDeg: null,
  activeTab: 'layers',

  layers: {
    showSectors: true,
    showBrahmastan: true,
    showPadas: false,
    showPadaBelts: false,
    showPadaScores: false,
    sectorOpacity: 0.4,
  },

  sat: {
    canvas: null,
    width: 0,
    height: 0,
    title: '',
    satPts: [],
    planPts: [],
  },
  satViewMode: 'idle', // 'idle' | 'sat' | 'plan-pick' | 'done'
  satZoom: 1,
  satPanX: 0,
  satPanY: 0,

  vastuMap: null,

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
const inspectorScroll = document.getElementById('inspectorScroll');

const statusBanner = document.getElementById('canvasStatusBanner');
const toggleCanvasSizeBtn = document.getElementById('toggleCanvasSizeBtn');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const zoomFitBtn = document.getElementById('zoomFitBtn');

const saveToast = document.getElementById('saveToast');
const saveToastText = document.getElementById('saveToastText');
const openSavedPreviewBtn = document.getElementById('openSavedPreviewBtn');

const planFileInput = document.getElementById('planFileInput');
const rotatePlan90Btn = document.getElementById('rotatePlan90Btn');
const loadSampleBtn = document.getElementById('loadSampleBtn');
const currentPlanTitle = document.getElementById('currentPlanTitle');
const planErrorBox = document.getElementById('planErrorBox');

const satFileInput = document.getElementById('satFileInput');
const satStepperBox = document.getElementById('satStepperBox');
const satStepSatBtn = document.getElementById('satStepSatBtn');
const satStepPlanBtn = document.getElementById('satStepPlanBtn');
const satStepDoneBtn = document.getElementById('satStepDoneBtn');
const satStepHintText = document.getElementById('satStepHintText');
const satResetPointsBtn = document.getElementById('satResetPointsBtn');
const satVerifyBox = document.getElementById('satVerifyBox');

const northReadoutBadge = document.getElementById('northReadoutBadge');
const northSlider = document.getElementById('northSlider');
const northNumberInput = document.getElementById('northNumberInput');

const vertexCountBadge = document.getElementById('vertexCountBadge');
const undoContourBtn = document.getElementById('undoContourBtn');
const deleteVertexBtn = document.getElementById('deleteVertexBtn');
const clearContourBtn = document.getElementById('clearContourBtn');
const orthoSnapToggle = document.getElementById('orthoSnapToggle');
const contourWarningBox = document.getElementById('contourWarningBox');

const layersBlockedBox = document.getElementById('layersBlockedBox');
const layersBlockedText = document.getElementById('layersBlockedText');
const gotoNorthStepBtn = document.getElementById('gotoNorthStepBtn');
const gotoContourStepBtn = document.getElementById('gotoContourStepBtn');
const layersReadyContent = document.getElementById('layersReadyContent');

const toggleSectors = document.getElementById('toggleSectors');
const toggleBrahmastan = document.getElementById('toggleBrahmastan');
const togglePadas = document.getElementById('togglePadas');
const padaSuboptions = document.getElementById('padaSuboptions');
const togglePadaBelts = document.getElementById('togglePadaBelts');
const togglePadaScores = document.getElementById('togglePadaScores');
const orientNorthUpBtn = document.getElementById('orientNorthUpBtn');
const orientAsOnSheetBtn = document.getElementById('orientAsOnSheetBtn');
const sectorOpacitySlider = document.getElementById('sectorOpacitySlider');
const sectorOpacityValue = document.getElementById('sectorOpacityValue');

const centerSummaryText = document.getElementById('centerSummaryText');
const zonesBalanceList = document.getElementById('zonesBalanceList');

const topExportBtn = document.getElementById('topExportBtn');
const exportPngBtn = document.getElementById('exportPngBtn');

const confirmModal = document.getElementById('confirmModal');
const confirmModalTitle = document.getElementById('confirmModalTitle');
const confirmModalMessage = document.getElementById('confirmModalMessage');
const confirmModalCancelBtn = document.getElementById('confirmModalCancelBtn');
const confirmModalAcceptBtn = document.getElementById('confirmModalAcceptBtn');

const imagePreviewModal = document.getElementById('imagePreviewModal');
const previewModalImg = document.getElementById('previewModalImg');
const closePreviewModalBtn = document.getElementById('closePreviewModalBtn');

const tabButtons = Array.from(document.querySelectorAll('.mode-tab'));
const tabPanes = {
  plan: document.getElementById('panelPlan'),
  contour: document.getElementById('panelContour'),
  layers: document.getElementById('panelLayers'),
};

let lastValidNorthInput = '22';
let lastExportDataUrl = null;
let saveToastTimer = null;
let persistTimer = null;
let cachedBasePlanDataUrl = null;

// ============================================================================
// Собственное диалоговое окно подтверждения
// ============================================================================
let pendingConfirmResolve = null;

function askUserConfirmation({
  title = 'Подтвердите действие',
  message = '',
  confirmText = 'Продолжить',
  cancelText = 'Отмена',
}) {
  if (pendingConfirmResolve) {
    pendingConfirmResolve(false);
    pendingConfirmResolve = null;
  }

  confirmModalTitle.textContent = title;
  confirmModalMessage.textContent = message;
  confirmModalAcceptBtn.textContent = confirmText;
  confirmModalCancelBtn.textContent = cancelText;
  confirmModal.hidden = false;

  return new Promise((resolve) => {
    pendingConfirmResolve = resolve;
  });
}

function closeConfirmModal(accepted) {
  confirmModal.hidden = true;
  if (pendingConfirmResolve) {
    const fn = pendingConfirmResolve;
    pendingConfirmResolve = null;
    fn(Boolean(accepted));
  }
}

confirmModalAcceptBtn.addEventListener('click', () => closeConfirmModal(true));
confirmModalCancelBtn.addEventListener('click', () => closeConfirmModal(false));
confirmModal.addEventListener('click', (e) => {
  if (e.target === confirmModal) closeConfirmModal(false);
});

closePreviewModalBtn.addEventListener('click', () => {
  imagePreviewModal.hidden = true;
});
imagePreviewModal.addEventListener('click', (e) => {
  if (e.target === imagePreviewModal) imagePreviewModal.hidden = true;
});

// ============================================================================
// Автосохранение сессии в IndexedDB / localStorage
// ============================================================================
function buildSessionRecord() {
  if (!state.isSamplePlan && !cachedBasePlanDataUrl && state.basePlanCanvas) {
    cachedBasePlanDataUrl = downscalePlanToDataUrl(state.basePlanCanvas, 1400);
  }

  return {
    version: 2,
    savedAt: Date.now(),
    isSamplePlan: state.isSamplePlan,
    sampleModified: state.sampleModified,
    planTitle: state.planTitle,
    sheetQuarterTurns: state.sheetQuarterTurns,
    basePlanWidth: state.basePlanCanvas ? state.basePlanCanvas.width : state.planWidth,
    basePlanHeight: state.basePlanCanvas ? state.basePlanCanvas.height : state.planHeight,
    basePlanDataUrl: state.isSamplePlan ? null : cachedBasePlanDataUrl,
    vertices: clonePointList(state.vertices),
    northSet: state.northSet,
    northAngleDeg:
      state.northSet && Number.isFinite(state.northAngleDeg)
        ? normalizeDeg(state.northAngleDeg)
        : null,
    alignNorthUp: state.alignNorthUp,
    orthoSnap: state.orthoSnap,
    activeTab: state.activeTab,
    layers: { ...state.layers },
  };
}

function schedulePersist(immediate = false) {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (immediate) {
    saveWorkspaceSession(buildSessionRecord()).catch(() => {});
    return;
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    saveWorkspaceSession(buildSessionRecord()).catch(() => {});
  }, 220);
}

// ============================================================================
// История «Отменить» (хранит лист, контур и Север единым снимком)
// ============================================================================
function pushUndoSnapshot() {
  state.undoHistory.push({
    sheetQuarterTurns: state.sheetQuarterTurns,
    planWidth: state.planWidth,
    planHeight: state.planHeight,
    vertices: state.vertices,
    satPlanPts: state.sat.planPts,
    northSet: state.northSet,
    northAngleDeg: state.northAngleDeg,
  });
  if (state.isSamplePlan) {
    state.sampleModified = true;
  }
}

function performUndo() {
  const snap = state.undoHistory.pop();
  if (!snap) return;

  const turnsChanged = snap.sheetQuarterTurns !== state.sheetQuarterTurns;
  state.sheetQuarterTurns = snap.sheetQuarterTurns;
  if (turnsChanged && state.basePlanCanvas) {
    state.planCanvas =
      snap.sheetQuarterTurns === 0
        ? state.basePlanCanvas
        : rotatePlanCanvas(state.basePlanCanvas, snap.sheetQuarterTurns);
    state.planWidth = state.planCanvas.width;
    state.planHeight = state.planCanvas.height;
  } else {
    state.planWidth = snap.planWidth;
    state.planHeight = snap.planHeight;
  }

  state.vertices = clonePointList(snap.vertices);
  state.sat.planPts = clonePointList(snap.satPlanPts);
  state.northSet = snap.northSet;
  state.northAngleDeg = snap.northAngleDeg;
  lastValidNorthInput =
    state.northSet && Number.isFinite(state.northAngleDeg)
      ? String(Math.round(state.northAngleDeg * 10) / 10)
      : '';

  state.selectedVertexIndex = Math.min(
    state.selectedVertexIndex,
    state.vertices.length - 1
  );

  recomputeVastuMap();
  if (turnsChanged) {
    fitPlanToViewport();
  }
  schedulePersist();
}

function pluralizeCorners(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} угол`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} угла`;
  return `${count} углов`;
}

function isViewingSatelliteCanvas() {
  return (
    state.activeTab === 'plan' &&
    state.satViewMode === 'sat' &&
    Boolean(state.sat && state.sat.canvas)
  );
}

function recomputeVastuMap() {
  if (state.vertices.length >= 3) {
    const northArg =
      state.northSet && Number.isFinite(state.northAngleDeg)
        ? state.northAngleDeg
        : null;
    state.vastuMap = buildVastuMap(state.vertices, northArg);
  } else {
    state.vastuMap = null;
  }
  syncInspectorUI();
  requestRender();
}

// ============================================================================
// Масштабирование и вписывание чертежа / снимка спутника
// ============================================================================
function fitPlanToViewport() {
  if (!state.planCanvas) return;
  const rect = canvasStage.getBoundingClientRect();
  const vw = Math.max(100, rect.width);
  const vh = Math.max(100, rect.height);

  const isPickingPlan =
    state.activeTab === 'plan' && state.satViewMode === 'plan-pick';
  const useNorthUp =
    !isPickingPlan &&
    state.northSet &&
    Number.isFinite(state.northAngleDeg) &&
    state.alignNorthUp;

  const rotRad = useNorthUp
    ? (-normalizeDeg(state.northAngleDeg) * Math.PI) / 180
    : 0;
  const absCos = Math.abs(Math.cos(rotRad));
  const absSin = Math.abs(Math.sin(rotRad));
  const effW = state.planWidth * absCos + state.planHeight * absSin;
  const effH = state.planWidth * absSin + state.planHeight * absCos;

  const sidePad = vw < 520 ? 28 : 56;
  const topHudSpace = vw < 520 ? 76 : 66;
  const bottomHudSpace = vw < 520 ? 64 : 60;
  const availW = Math.max(60, vw - sidePad * 2);
  const availH = Math.max(60, vh - topHudSpace - bottomHudSpace);

  state.zoom = Math.min(
    Math.max(0.06, availW / Math.max(1, effW)),
    Math.max(0.06, availH / Math.max(1, effH))
  );
  state.panX = 0;
  state.panY = (topHudSpace - bottomHudSpace) * 0.5;
  requestRender();
}

function fitSatelliteToViewport() {
  if (!state.sat.canvas) return;
  const rect = canvasStage.getBoundingClientRect();
  const vw = Math.max(100, rect.width);
  const vh = Math.max(100, rect.height);

  const sidePad = vw < 520 ? 18 : 40;
  const topSpace = vw < 520 ? 84 : 58;
  const bottomSpace = 58;
  const availW = Math.max(60, vw - sidePad * 2);
  const availH = Math.max(60, vh - topSpace - bottomSpace);

  state.satZoom = Math.min(
    Math.max(0.06, availW / Math.max(1, state.sat.width)),
    Math.max(0.06, availH / Math.max(1, state.sat.height))
  );
  state.satPanX = 0;
  state.satPanY = (topSpace - bottomSpace) * 0.5;
  requestRender();
}

function zoomByFactor(factor, pivotScreen = null) {
  const rect = canvasStage.getBoundingClientRect();
  const cx = pivotScreen ? pivotScreen.x : rect.width * 0.5;
  const cy = pivotScreen ? pivotScreen.y : rect.height * 0.5;

  if (isViewingSatelliteCanvas()) {
    const prev = state.satZoom;
    const next = Math.max(0.1, Math.min(8, prev * factor));
    const ratio = next / prev;
    const dx = cx - rect.width * 0.5 - state.satPanX;
    const dy = cy - rect.height * 0.5 - state.satPanY;
    state.satPanX -= dx * (ratio - 1);
    state.satPanY -= dy * (ratio - 1);
    state.satZoom = next;
    requestRender();
    return;
  }

  if (!state.planCanvas) return;
  const prevZoom = state.zoom;
  const nextZoom = Math.max(0.1, Math.min(8, prevZoom * factor));
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

// ============================================================================
// Переключение вкладок и синхронизация интерфейса
// ============================================================================
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

  // При смене вкладки панель прокручивается в самое начало
  if (inspectorScroll) {
    inspectorScroll.scrollTop = 0;
  }

  syncInspectorUI();
  requestRender();
  schedulePersist();
}

function setNorthAngle(deg, options = {}) {
  const { keepFrozenRotation = false, fitAfter = false } = options;
  state.northSet = true;
  state.northAngleDeg = normalizeDeg(deg);
  if (state.isSamplePlan) {
    state.sampleModified = true;
  }

  const roundedDisp = Math.round(state.northAngleDeg * 10) / 10;
  lastValidNorthInput = String(roundedDisp);

  if (!keepFrozenRotation) {
    state.frozenRotationDeg = null;
  }

  recomputeVastuMap();
  if (fitAfter) {
    fitPlanToViewport();
  }
  schedulePersist();
}

function tryComputeNorthFromSatellite() {
  if (state.sat.satPts.length < 2 || state.sat.planPts.length < 2) {
    return false;
  }
  const computed = northAngleFromWallSegments(
    state.sat.satPts[0],
    state.sat.satPts[1],
    state.sat.planPts[0],
    state.sat.planPts[1]
  );
  if (computed === null) {
    return false;
  }
  state.satViewMode = 'done';
  setNorthAngle(computed, { fitAfter: true });
  return true;
}

function syncSatelliteUI() {
  const hasSat = Boolean(state.sat.canvas);
  satStepperBox.hidden = !hasSat;

  if (!hasSat) {
    satVerifyBox.hidden = true;
    return;
  }

  const satCount = state.sat.satPts.length;
  const planCount = state.sat.planPts.length;
  const bothReady = satCount === 2 && planCount === 2 && state.northSet;

  satStepSatBtn.classList.toggle('is-active', state.satViewMode === 'sat');
  satStepPlanBtn.classList.toggle('is-active', state.satViewMode === 'plan-pick');
  satStepDoneBtn.disabled = !bothReady;
  satStepDoneBtn.classList.toggle('is-active', state.satViewMode === 'done');

  if (state.satViewMode === 'sat') {
    if (satCount === 0) {
      satStepHintText.textContent =
        'Шаг 1 из 2: коснитесь на снимке первого угла выбранной стены дома (точка «1»).';
    } else if (satCount === 1) {
      satStepHintText.textContent =
        'Точка «1» стоит — теперь коснитесь второго угла этой же стены на снимке (точка «2»).';
    } else {
      satStepHintText.textContent =
        'Стена 1 → 2 на снимке отмечена. Нажмите «2. На плане» или перетащите точки для уточнения.';
    }
  } else if (state.satViewMode === 'plan-pick') {
    if (planCount === 0) {
      satStepHintText.textContent =
        'Шаг 2 из 2: коснитесь того же первого угла стены на плане квартиры (точка «1»).';
    } else if (planCount === 1) {
      satStepHintText.textContent =
        'Точка «1» на плане отмечена — коснитесь второго угла этой же стены в том же порядке (точка «2»).';
    } else {
      satStepHintText.textContent =
        'Обе точки на плане отмечены — точки 1 и 2 можно подвинуть пальцем для точности.';
    }
  } else {
    satStepHintText.textContent =
      'Расчёт завершён. При желании вы можете вернуться к точкам на снимке или на плане.';
  }

  satVerifyBox.hidden = !(bothReady && state.satViewMode === 'done');
}

function syncStatusBanner() {
  if (state.activeTab === 'plan') {
    if (state.satViewMode === 'sat' && state.sat.canvas) {
      const n = state.sat.satPts.length;
      statusBanner.textContent =
        n === 0
          ? 'Снимок спутника: коснитесь угла «1» наружной стены дома'
          : n === 1
            ? 'Снимок спутника: коснитесь угла «2» той же стены дома'
            : 'Стена 1 → 2 на снимке отмечена';
      return;
    }
    if (state.satViewMode === 'plan-pick') {
      const n = state.sat.planPts.length;
      statusBanner.textContent =
        n === 0
          ? 'План квартиры: отметьте тот же угол «1» в том же порядке'
          : 'План квартиры: отметьте второй угол «2» этой стены';
      return;
    }
    if (!state.northSet) {
      statusBanner.textContent =
        'Север не задан · Загрузите скриншот со спутника или поверните «С»';
      return;
    }
    statusBanner.textContent =
      'Направление «С» задано · При необходимости чуть подправьте стрелку «С»';
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
        'Линии стен пересекаются: передвиньте угол или нажмите «Отменить»';
    } else {
      statusBanner.textContent = `Готово: ${pluralizeCorners(state.vertices.length)}. Неточный угол можно передвинуть пальцем`;
    }
    return;
  }

  // Вкладка «Что показать на карте»
  if (!state.northSet && state.vertices.length < 3) {
    statusBanner.textContent =
      'Укажите Север и обведите контур квартиры, чтобы увидеть карту';
    return;
  }
  if (!state.northSet) {
    statusBanner.textContent =
      'Север ещё не задан · Откройте «План и север»';
    return;
  }
  if (!state.vastuMap || state.vastuMap.selfIntersects) {
    statusBanner.textContent =
      'Откройте «Контур стен» и замкните внутренние углы квартиры';
    return;
  }
  if (state.vastuMap.centerOutsideOrClipped) {
    statusBanner.textContent = CENTER_OUTSIDE_NOTE;
    return;
  }

  const orientWord = state.alignNorthUp ? 'Север сверху' : 'Как на листе плана';
  const active = [];
  if (state.layers.showSectors) active.push('8 секторов');
  if (state.layers.showBrahmastan) active.push('Брахмастан по форме квартиры');
  if (state.layers.showPadas) active.push('Сетка 32 пад');
  statusBanner.textContent =
    active.length > 0
      ? `${orientWord} · ${active.join(' · ')}`
      : 'Выберите слои ниже, чтобы отобразить их на плане';
}

function syncInspectorUI() {
  currentPlanTitle.textContent = state.planTitle || 'План квартиры';

  if (state.northSet && Number.isFinite(state.northAngleDeg)) {
    const roundedNorth = Math.round(state.northAngleDeg * 10) / 10;
    northReadoutBadge.textContent = `${String(roundedNorth).replace('.', ',')}°`;
    northReadoutBadge.classList.remove('is-unset');
    northSlider.value = String(Math.round(state.northAngleDeg));
    if (document.activeElement !== northNumberInput) {
      northNumberInput.value = String(roundedNorth);
      lastValidNorthInput = String(roundedNorth);
    }
  } else {
    northReadoutBadge.textContent = 'Не задан';
    northReadoutBadge.classList.add('is-unset');
    northSlider.value = '0';
    if (document.activeElement !== northNumberInput) {
      northNumberInput.value = '';
      lastValidNorthInput = '';
    }
  }

  syncSatelliteUI();

  vertexCountBadge.textContent = pluralizeCorners(state.vertices.length);
  undoContourBtn.disabled = state.undoHistory.length === 0;
  deleteVertexBtn.disabled = state.vertices.length === 0;
  clearContourBtn.disabled = state.vertices.length === 0;
  orthoSnapToggle.checked = state.orthoSnap;

  if (state.vastuMap && state.vastuMap.selfIntersects) {
    contourWarningBox.hidden = false;
    contourWarningBox.textContent =
      'Линии стен пересекаются между собой. Передвиньте угол так, чтобы обход шёл последовательно по периметру, или нажмите «Отменить».';
  } else {
    contourWarningBox.hidden = true;
  }

  // Переключатели слоёв и блок готовности карты
  toggleSectors.checked = state.layers.showSectors;
  toggleBrahmastan.checked = state.layers.showBrahmastan;
  togglePadas.checked = state.layers.showPadas;
  togglePadaBelts.checked = state.layers.showPadaBelts;
  togglePadaScores.checked = state.layers.showPadaScores;
  padaSuboptions.hidden = !state.layers.showPadas;

  orientNorthUpBtn.classList.toggle('is-active', state.alignNorthUp);
  orientAsOnSheetBtn.classList.toggle('is-active', !state.alignNorthUp);

  const opacityPct = Math.round(state.layers.sectorOpacity * 100);
  sectorOpacitySlider.value = String(opacityPct);
  sectorOpacityValue.textContent = `${opacityPct}%`;

  const hasValidContour = Boolean(
    state.vertices.length >= 3 && state.vastuMap && !state.vastuMap.selfIntersects
  );
  const canShowReadyMap = Boolean(state.northSet && hasValidContour);
  const canExport = canExportVastuMap(state);

  topExportBtn.disabled = !canExport;
  exportPngBtn.disabled = !canExport;
  topExportBtn.title = canExport
    ? 'Скачать готовую Васту-карту в PNG'
    : 'Сначала задайте Север и замкните контур квартиры';

  layersBlockedBox.hidden = canShowReadyMap;
  layersReadyContent.hidden = !canShowReadyMap;

  if (!canShowReadyMap) {
    gotoNorthStepBtn.hidden = state.northSet;
    gotoContourStepBtn.hidden = hasValidContour;
    if (!state.northSet && !hasValidContour) {
      layersBlockedText.textContent =
        'Пока Север не задан и контур не замкнут, сектора и сетка пад скрыты. Выполните два шага: укажите Север по снимку со спутника и отметьте внутренние углы квартиры.';
    } else if (!state.northSet) {
      layersBlockedText.textContent =
        'Контур квартиры готов. Осталось указать направление на Север по снимку со спутника (или ввести градусы вручную) во вкладке «План и север».';
    } else {
      layersBlockedText.textContent =
        'Направление на Север задано. Перейдите во вкладку «Контур стен» и отметьте минимум 3 внутренних угла квартиры по периметру.';
    }
  } else {
    if (state.vastuMap.centerOutsideOrClipped) {
      centerSummaryText.textContent = `${CENTER_OUTSIDE_NOTE}. В квартирах П-образной или сдвоенной формы расчётная точка центра попадает за пределы жилого контура.`;
    } else if (state.vastuMap.brahmastan && state.vastuMap.brahmastan.wasClipped) {
      centerSummaryText.textContent =
        'Центр квартиры (Брахмабинду) найден по настоящей форме контура. Выступавшая за наружную стену часть Брахмастана аккуратно отсечена по методу С. А. Балуты.';
    } else {
      centerSummaryText.textContent =
        'Центр квартиры (Брахмабинду) рассчитан по настоящей форме контура и отмечен на плане.';
    }
    renderZonesList(state.vastuMap.sectors);
  }

  syncStatusBanner();
}

function renderZonesList(computedSectors) {
  const list = computedSectors && computedSectors.length > 0 ? computedSectors : SECTORS;
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

    card.appendChild(swatch);
    card.appendChild(meta);
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

/**
 * Попадание в значок «С»: работает ТОЛЬКО во вкладке севера, строго по границам нарисованного значка.
 */
function hitTestNorthHandle(screenPt) {
  if (state.activeTab !== 'plan' || isViewingSatelliteCanvas() || state.satViewMode === 'plan-pick') {
    return false;
  }
  const h = state.lastRenderMeta && state.lastRenderMeta.northHandleScreen;
  if (!h) return false;
  const half = h.halfSize || 20;
  return (
    Math.abs(screenPt.x - h.x) <= half &&
    Math.abs(screenPt.y - h.y) <= half
  );
}

/**
 * Радиусы касания угла: 26 px для пальца и 12 px для мыши.
 */
function hitTestVertex(screenPt, isTouch = false) {
  if (!state.lastRenderMeta || state.vertices.length === 0) return -1;
  const xf = state.lastRenderMeta.transform;
  const hitR = isTouch ? 26 : 12;
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
  const hitR = isTouch ? 22 : 11;
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

function hitTestPointList(screenPt, imgPts, isTouch = false) {
  if (!state.lastRenderMeta || !imgPts || imgPts.length === 0) return -1;
  const xf = state.lastRenderMeta.transform;
  const hitR = isTouch ? 26 : 15;
  for (let i = 0; i < imgPts.length; i++) {
    const sp = xf.planToScreen(imgPts[i]);
    if (distance(screenPt, sp) <= hitR) return i;
  }
  return -1;
}

// ============================================================================
// Обработка касаний и мыши на чертеже
// ============================================================================
const activePointers = new Map();
let gesture = null;

mapCanvas.addEventListener('pointerdown', (e) => {
  if (!state.planCanvas && !isViewingSatelliteCanvas()) return;
  try {
    mapCanvas.setPointerCapture(e.pointerId);
  } catch {
    // Игнорируем синтетические события без pointerId в старых средах
  }

  const pt = getCanvasLocalPoint(e.clientX, e.clientY);
  const isTouch = e.pointerType === 'touch';
  activePointers.set(e.pointerId, pt);

  // Два пальца -> масштабирование щипком (pinch-to-zoom)
  if (activePointers.size === 2) {
    state.frozenRotationDeg = null;
    const pts = Array.from(activePointers.values());
    const mid = { x: (pts[0].x + pts[1].x) * 0.5, y: (pts[0].y + pts[1].y) * 0.5 };
    gesture = {
      type: 'pinch',
      startDist: Math.max(10, distance(pts[0], pts[1])),
      startZoom: isViewingSatelliteCanvas() ? state.satZoom : state.zoom,
      lastMid: mid,
    };
    return;
  }

  if (activePointers.size > 2) return;

  // Режим отметки точек 1 и 2 на снимке спутника
  if (isViewingSatelliteCanvas()) {
    const hitSatIdx = hitTestPointList(pt, state.sat.satPts, isTouch);
    if (hitSatIdx !== -1) {
      gesture = { type: 'drag-sat-pt', target: 'sat', pointIndex: hitSatIdx };
      return;
    }
    gesture = { type: 'pan-or-tap', startPt: pt, lastPt: pt, moved: false };
    return;
  }

  // Режим отметки/поправки точек 1 и 2 стены на плане во вкладке «План и север»
  if (state.activeTab === 'plan' && state.sat.planPts.length > 0) {
    const hitPlanWallIdx = hitTestPointList(pt, state.sat.planPts, isTouch);
    if (hitPlanWallIdx !== -1) {
      gesture = { type: 'drag-sat-pt', target: 'plan', pointIndex: hitPlanWallIdx };
      return;
    }
  }

  // Вращение стрелки «С» — ТОЛЬКО во вкладке севера, на изменение угла пальца
  if (state.activeTab === 'plan' && hitTestNorthHandle(pt)) {
    const h = state.lastRenderMeta.northHandleScreen;
    const initialNorth =
      state.northSet && Number.isFinite(state.northAngleDeg)
        ? state.northAngleDeg
        : 0;
    const currentRot =
      state.northSet && Number.isFinite(state.northAngleDeg) && state.alignNorthUp
        ? -normalizeDeg(state.northAngleDeg)
        : 0;
    state.frozenRotationDeg = currentRot;
    gesture = {
      type: 'rotate-north',
      originX: h.originX,
      originY: h.originY,
      lastScreenAngle: vectorToAzimuthDeg(pt.x - h.originX, pt.y - h.originY),
      startNorthDeg: initialNorth,
      accumDelta: 0,
    };
    return;
  }

  // Во вкладке «Контур стен»: выбор/перетаскивание угла или вставка угла на стене
  // (снимок истории сохраняется только при первом реальном сдвиге угла!)
  if (state.activeTab === 'contour') {
    const vIdx = hitTestVertex(pt, isTouch);
    if (vIdx !== -1) {
      state.selectedVertexIndex = vIdx;
      gesture = {
        type: 'drag-vertex',
        vertexIndex: vIdx,
        startPt: pt,
        snapshotSaved: false,
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
        startPt: pt,
        snapshotSaved: true,
      };
      recomputeVastuMap();
      schedulePersist();
      return;
    }
  }

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
    if (e.pointerType === 'mouse') {
      if (state.activeTab === 'contour') {
        const vIdx = hitTestVertex(pt, false);
        const eIdx = vIdx === -1 ? hitTestEdgeMidpoint(pt, false) : -1;
        if (vIdx !== state.hoveredVertexIndex || eIdx !== state.hoveredEdgeMidpoint) {
          state.hoveredVertexIndex = vIdx;
          state.hoveredEdgeMidpoint = eIdx;
          mapCanvas.style.cursor = vIdx !== -1 || eIdx !== -1 ? 'pointer' : 'crosshair';
          requestRender();
        }
      } else if (state.activeTab === 'plan') {
        if (isViewingSatelliteCanvas() || state.satViewMode === 'plan-pick') {
          mapCanvas.style.cursor = 'crosshair';
        } else {
          mapCanvas.style.cursor = hitTestNorthHandle(pt) ? 'pointer' : 'grab';
        }
      } else {
        mapCanvas.style.cursor = 'grab';
      }
    }
    return;
  }

  if (gesture.type === 'pinch' && activePointers.size >= 2) {
    const pts = Array.from(activePointers.values());
    const mid = { x: (pts[0].x + pts[1].x) * 0.5, y: (pts[0].y + pts[1].y) * 0.5 };
    const currDist = Math.max(10, distance(pts[0], pts[1]));

    if (isViewingSatelliteCanvas()) {
      state.satPanX += mid.x - gesture.lastMid.x;
      state.satPanY += mid.y - gesture.lastMid.y;
      const targetZoom = Math.max(
        0.1,
        Math.min(8, gesture.startZoom * (currDist / gesture.startDist))
      );
      zoomByFactor(targetZoom / state.satZoom, mid);
    } else {
      state.panX += mid.x - gesture.lastMid.x;
      state.panY += mid.y - gesture.lastMid.y;
      const targetZoom = Math.max(
        0.1,
        Math.min(8, gesture.startZoom * (currDist / gesture.startDist))
      );
      zoomByFactor(targetZoom / state.zoom, mid);
    }
    gesture.lastMid = mid;
    return;
  }

  if (gesture.type === 'drag-sat-pt' && state.lastRenderMeta) {
    const rawPt = state.lastRenderMeta.transform.screenToPlan(pt);
    if (gesture.target === 'sat' && state.sat.canvas) {
      state.sat.satPts[gesture.pointIndex] = {
        x: Math.max(0, Math.min(state.sat.width, rawPt.x)),
        y: Math.max(0, Math.min(state.sat.height, rawPt.y)),
      };
      if (state.sat.satPts.length === 2 && state.sat.planPts.length === 2) {
        const deg = northAngleFromWallSegments(
          state.sat.satPts[0],
          state.sat.satPts[1],
          state.sat.planPts[0],
          state.sat.planPts[1]
        );
        if (deg !== null) {
          state.northSet = true;
          state.northAngleDeg = deg;
          recomputeVastuMap();
          return;
        }
      }
      requestRender();
    } else if (gesture.target === 'plan') {
      state.sat.planPts[gesture.pointIndex] = {
        x: Math.max(0, Math.min(state.planWidth, rawPt.x)),
        y: Math.max(0, Math.min(state.planHeight, rawPt.y)),
      };
      if (state.sat.satPts.length === 2 && state.sat.planPts.length === 2) {
        const deg = northAngleFromWallSegments(
          state.sat.satPts[0],
          state.sat.satPts[1],
          state.sat.planPts[0],
          state.sat.planPts[1]
        );
        if (deg !== null) {
          setNorthAngle(deg, { keepFrozenRotation: true });
          return;
        }
      }
      requestRender();
    }
    return;
  }

  if (gesture.type === 'rotate-north') {
    const currAngle = vectorToAzimuthDeg(pt.x - gesture.originX, pt.y - gesture.originY);
    const stepDelta = signedAngleDeltaDeg(gesture.lastScreenAngle, currAngle);
    gesture.accumDelta += stepDelta;
    gesture.lastScreenAngle = currAngle;
    setNorthAngle(gesture.startNorthDeg + gesture.accumDelta, {
      keepFrozenRotation: true,
    });
    return;
  }

  if (gesture.type === 'drag-vertex' && state.lastRenderMeta) {
    if (!gesture.snapshotSaved && distance(pt, gesture.startPt) < 2) {
      return;
    }
    if (!gesture.snapshotSaved) {
      pushUndoSnapshot();
      gesture.snapshotSaved = true;
    }

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
    schedulePersist();
    return;
  }

  if (gesture.type === 'pan-or-tap') {
    const totalMove = distance(pt, gesture.startPt);
    if (totalMove > 6) {
      gesture.moved = true;
    }
    if (gesture.moved) {
      if (isViewingSatelliteCanvas()) {
        state.satPanX += pt.x - gesture.lastPt.x;
        state.satPanY += pt.y - gesture.lastPt.y;
      } else {
        state.panX += pt.x - gesture.lastPt.x;
        state.panY += pt.y - gesture.lastPt.y;
      }
      gesture.lastPt = pt;
      requestRender();
    }
  }
});

function finalizeRemainingPointers() {
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

mapCanvas.addEventListener('pointerup', (e) => {
  const pt = getCanvasLocalPoint(e.clientX, e.clientY);
  activePointers.delete(e.pointerId);

  if (gesture && gesture.type === 'rotate-north') {
    state.frozenRotationDeg = null;
    if (state.alignNorthUp) {
      fitPlanToViewport();
    } else {
      requestRender();
    }
    schedulePersist();
  } else if (
    gesture &&
    gesture.type === 'pan-or-tap' &&
    !gesture.moved &&
    state.lastRenderMeta
  ) {
    const rawImgPt = state.lastRenderMeta.transform.screenToPlan(pt);

    // 1. Отметка точек 1 и 2 на снимке спутника
    if (isViewingSatelliteCanvas() && state.sat.canvas) {
      if (
        rawImgPt.x >= -15 &&
        rawImgPt.x <= state.sat.width + 15 &&
        rawImgPt.y >= -15 &&
        rawImgPt.y <= state.sat.height + 15 &&
        state.sat.satPts.length < 2
      ) {
        const clamped = {
          x: Math.max(0, Math.min(state.sat.width, rawImgPt.x)),
          y: Math.max(0, Math.min(state.sat.height, rawImgPt.y)),
        };
        if (
          state.sat.satPts.length === 0 ||
          distance(state.sat.satPts[0], clamped) > 4
        ) {
          state.sat.satPts.push(clamped);
          if (state.sat.satPts.length === 2) {
            if (state.sat.planPts.length === 2) {
              tryComputeNorthFromSatellite();
            } else {
              state.satViewMode = 'plan-pick';
              syncInspectorUI();
              fitPlanToViewport();
            }
          } else {
            syncInspectorUI();
            requestRender();
          }
        }
      }
    }
    // 2. Отметка точек 1 и 2 стены на плане квартиры
    else if (state.activeTab === 'plan' && state.satViewMode === 'plan-pick') {
      if (
        rawImgPt.x >= -15 &&
        rawImgPt.x <= state.planWidth + 15 &&
        rawImgPt.y >= -15 &&
        rawImgPt.y <= state.planHeight + 15 &&
        state.sat.planPts.length < 2
      ) {
        const clamped = {
          x: Math.max(0, Math.min(state.planWidth, rawImgPt.x)),
          y: Math.max(0, Math.min(state.planHeight, rawImgPt.y)),
        };
        if (
          state.sat.planPts.length === 0 ||
          distance(state.sat.planPts[0], clamped) > 4
        ) {
          state.sat.planPts.push(clamped);
          if (state.sat.planPts.length === 2) {
            tryComputeNorthFromSatellite();
          } else {
            syncInspectorUI();
            requestRender();
          }
        }
      }
    }
    // 3. Добавление внутреннего угла во вкладке «Контур стен» (только по pointerup!)
    else if (state.activeTab === 'contour') {
      if (
        rawImgPt.x >= -20 &&
        rawImgPt.x <= state.planWidth + 20 &&
        rawImgPt.y >= -20 &&
        rawImgPt.y <= state.planHeight + 20
      ) {
        const clamped = {
          x: Math.max(0, Math.min(state.planWidth, rawImgPt.x)),
          y: Math.max(0, Math.min(state.planHeight, rawImgPt.y)),
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
        schedulePersist();
      }
    }
  }

  finalizeRemainingPointers();
});

// pointercancel никогда не добавляет новый угол!
mapCanvas.addEventListener('pointercancel', (e) => {
  activePointers.delete(e.pointerId);
  if (state.frozenRotationDeg !== null) {
    state.frozenRotationDeg = null;
    requestRender();
  }
  finalizeRemainingPointers();
});

// Масштабирование колесом мыши / трекпадом
mapCanvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const pt = getCanvasLocalPoint(e.clientX, e.clientY);
    const factor = Math.pow(1.0018, -e.deltaY);
    zoomByFactor(factor, pt);
  },
  { passive: false }
);

// ============================================================================
// Привязка кнопок интерфейса
// ============================================================================
for (const btn of tabButtons) {
  btn.addEventListener('click', () => {
    setActiveTab(btn.dataset.tab);
  });
}

gotoNorthStepBtn.addEventListener('click', () => setActiveTab('plan'));
gotoContourStepBtn.addEventListener('click', () => setActiveTab('contour'));

zoomInBtn.addEventListener('click', () => zoomByFactor(1.25));
zoomOutBtn.addEventListener('click', () => zoomByFactor(0.8));
zoomFitBtn.addEventListener('click', () => {
  if (isViewingSatelliteCanvas()) {
    fitSatelliteToViewport();
  } else {
    fitPlanToViewport();
  }
});

toggleCanvasSizeBtn.addEventListener('click', () => {
  const expanded = studioShell.classList.toggle('canvas-expanded');
  toggleCanvasSizeBtn.textContent = expanded ? 'Компактно' : 'Крупнее';
  setTimeout(() => {
    if (isViewingSatelliteCanvas()) {
      fitSatelliteToViewport();
    } else {
      fitPlanToViewport();
    }
  }, 30);
});

// Загрузка собственного плана ученицы: Север не задан, не берёт 22° с учебного плана!
planFileInput.addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  planFileInput.value = '';
  if (!file) return;

  const hasExistingUserCorners =
    state.vertices.length > 0 && (!state.isSamplePlan || state.sampleModified);

  if (hasExistingUserCorners) {
    const confirmed = await askUserConfirmation({
      title: 'Заменить текущий план?',
      message:
        'На текущем плане уже отмечены углы контура. При открытии нового файла контур и настройка Севера будут сброшены.',
      confirmText: 'Открыть новый план',
      cancelText: 'Оставить текущий',
    });
    if (!confirmed) return;
  }

  planErrorBox.hidden = true;
  statusBanner.textContent = 'Открываем файл плана…';

  try {
    const loaded = await loadPlanFromFile(file);
    state.isSamplePlan = false;
    state.sampleModified = false;
    state.basePlanCanvas = loaded.canvas;
    state.sheetQuarterTurns = 0;
    state.planCanvas = loaded.canvas;
    state.planWidth = loaded.width;
    state.planHeight = loaded.height;
    state.planTitle = loaded.title;
    cachedBasePlanDataUrl = downscalePlanToDataUrl(loaded.canvas, 1400);

    state.vertices = [];
    state.undoHistory.clear();
    state.selectedVertexIndex = -1;

    // Север на новом плане не задан — не переносим 22° с учебного примера!
    state.northSet = false;
    state.northAngleDeg = null;
    state.frozenRotationDeg = null;
    state.alignNorthUp = true;
    lastValidNorthInput = '';

    state.sat.planPts = [];
    if (state.sat.canvas && state.sat.satPts.length === 2) {
      state.satViewMode = 'plan-pick';
    } else if (state.sat.canvas) {
      state.satViewMode = 'sat';
    } else {
      state.satViewMode = 'idle';
    }

    setActiveTab('plan');
    recomputeVastuMap();
    fitPlanToViewport();
    schedulePersist(true);
  } catch (err) {
    const msg =
      err && err.message
        ? err.message
        : 'Не получилось открыть этот файл плана — загрузите план как фото или скриншот.';
    planErrorBox.textContent = msg;
    planErrorBox.hidden = false;
    statusBanner.textContent = msg;
    setActiveTab('plan');
  }
});

// Загрузка скриншота спутниковой карты (основной способ «Север по спутнику»)
satFileInput.addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  satFileInput.value = '';
  if (!file) return;

  planErrorBox.hidden = true;
  try {
    const loaded = await loadSatelliteFromFile(file);
    state.sat.canvas = loaded.canvas;
    state.sat.width = loaded.width;
    state.sat.height = loaded.height;
    state.sat.title = loaded.title;
    state.sat.satPts = [];
    state.sat.planPts = [];
    state.satViewMode = 'sat';

    setActiveTab('plan');
    syncInspectorUI();
    fitSatelliteToViewport();
    const satBlock = satStepperBox.closest('.panel-block');
    if (satBlock && inspectorScroll) {
      const deltaTop =
        satBlock.getBoundingClientRect().top -
        inspectorScroll.getBoundingClientRect().top;
      inspectorScroll.scrollTop = Math.max(0, inspectorScroll.scrollTop + deltaTop - 6);
    }
  } catch (err) {
    const msg =
      err && err.message
        ? err.message
        : 'Не получилось прочитать скриншот со спутника. Загрузите JPG или PNG.';
    planErrorBox.textContent = msg;
    planErrorBox.hidden = false;
    statusBanner.textContent = msg;
  }
});

satStepSatBtn.addEventListener('click', () => {
  if (!state.sat.canvas) return;
  state.satViewMode = 'sat';
  syncInspectorUI();
  fitSatelliteToViewport();
});

satStepPlanBtn.addEventListener('click', () => {
  if (!state.sat.canvas) return;
  state.satViewMode = 'plan-pick';
  syncInspectorUI();
  fitPlanToViewport();
});

satStepDoneBtn.addEventListener('click', () => {
  if (!state.northSet) return;
  state.satViewMode = 'done';
  syncInspectorUI();
  fitPlanToViewport();
});

satResetPointsBtn.addEventListener('click', () => {
  if (!state.sat.canvas) return;
  if (state.satViewMode === 'plan-pick') {
    state.sat.planPts = [];
  } else {
    state.sat.satPts = [];
    state.sat.planPts = [];
    state.satViewMode = 'sat';
    fitSatelliteToViewport();
  }
  syncInspectorUI();
  requestRender();
});

// Поворот загруженного листа плана на 90° по часовой стрелке (единый снимок в историю «Отменить»)
rotatePlan90Btn.addEventListener('click', () => {
  if (!state.planCanvas || !state.basePlanCanvas) return;
  pushUndoSnapshot();

  const rotatedState = applySheetRotation90CW({
    sheetQuarterTurns: state.sheetQuarterTurns,
    planWidth: state.planWidth,
    planHeight: state.planHeight,
    vertices: state.vertices,
    satPlanPts: state.sat.planPts,
    northSet: state.northSet,
    northAngleDeg: state.northAngleDeg,
  });

  state.sheetQuarterTurns = rotatedState.sheetQuarterTurns;
  state.planCanvas =
    state.sheetQuarterTurns === 0
      ? state.basePlanCanvas
      : rotatePlanCanvas(state.basePlanCanvas, state.sheetQuarterTurns);
  state.planWidth = state.planCanvas.width;
  state.planHeight = state.planCanvas.height;
  state.vertices = rotatedState.vertices;
  state.sat.planPts = rotatedState.satPlanPts;
  state.northSet = rotatedState.northSet;
  state.northAngleDeg = rotatedState.northAngleDeg;
  lastValidNorthInput =
    state.northSet && Number.isFinite(state.northAngleDeg)
      ? String(Math.round(state.northAngleDeg * 10) / 10)
      : '';

  recomputeVastuMap();
  fitPlanToViewport();
  schedulePersist();
});

// Открытие учебного Г-образного плана
function openSamplePlan({ preserveSettings = false } = {}) {
  const sample = createSampleFloorPlan();
  state.isSamplePlan = true;
  state.sampleModified = false;
  state.basePlanCanvas = sample.canvas;
  state.sheetQuarterTurns = 0;
  state.planCanvas = sample.canvas;
  state.planWidth = sample.width;
  state.planHeight = sample.height;
  state.planTitle = sample.title;
  cachedBasePlanDataUrl = null;

  state.vertices = clonePointList(sample.defaultVertices);
  state.undoHistory.clear();
  state.selectedVertexIndex = -1;
  state.northSet = true;
  state.northAngleDeg = sample.defaultNorthDeg;
  state.frozenRotationDeg = null;
  lastValidNorthInput = String(sample.defaultNorthDeg);

  state.sat.canvas = null;
  state.sat.satPts = [];
  state.sat.planPts = [];
  state.satViewMode = 'idle';

  if (!preserveSettings) {
    state.alignNorthUp = true;
  }

  planErrorBox.hidden = true;
  recomputeVastuMap();
  fitPlanToViewport();
}

loadSampleBtn.addEventListener('click', async () => {
  const confirmed = await askUserConfirmation({
    title: 'Вернуть учебный план?',
    message:
      'Текущий чертёж, отмеченные углы и настройка Севера заменятся учебным примером Г-образной квартиры.',
    confirmText: 'Вернуть учебный план',
    cancelText: 'Отмена',
  });
  if (!confirmed) return;
  openSamplePlan();
  schedulePersist(true);
});

// Управление направлением на Север (ползунок, поле 0–360° с выделением при фокусе, быстрые кнопки)
northSlider.addEventListener('input', () => {
  const val = Number(northSlider.value);
  if (Number.isFinite(val)) {
    setNorthAngle(val, { fitAfter: state.alignNorthUp });
  }
});

let selectOnMouseUp = false;
northNumberInput.addEventListener('focus', () => {
  northNumberInput.select();
  selectOnMouseUp = true;
});
northNumberInput.addEventListener('mouseup', (e) => {
  if (selectOnMouseUp) {
    e.preventDefault();
    selectOnMouseUp = false;
  }
});

northNumberInput.addEventListener('keydown', (e) => {
  if (e.key === '-' || e.key === '+' || e.key === 'e' || e.key === 'E') {
    e.preventDefault();
  }
});

northNumberInput.addEventListener('input', () => {
  if (northNumberInput.validity && northNumberInput.validity.badInput) {
    northNumberInput.value = lastValidNorthInput;
    return;
  }
  const check = validateNorthDegreeInput(northNumberInput.value);
  if (!check.ok) {
    northNumberInput.value = lastValidNorthInput;
    return;
  }
  if (check.empty) {
    return;
  }
  lastValidNorthInput = northNumberInput.value;
  setNorthAngle(check.value, { fitAfter: state.alignNorthUp });
});

northNumberInput.addEventListener('blur', () => {
  const check = validateNorthDegreeInput(northNumberInput.value);
  if (!check.ok || check.empty) {
    if (state.northSet && Number.isFinite(state.northAngleDeg)) {
      const rounded = Math.round(state.northAngleDeg * 10) / 10;
      northNumberInput.value = String(rounded);
      lastValidNorthInput = String(rounded);
    } else {
      northNumberInput.value = '';
      lastValidNorthInput = '';
    }
  }
});

for (const chip of document.querySelectorAll('[data-north]')) {
  chip.addEventListener('click', () => {
    setNorthAngle(Number(chip.getAttribute('data-north')), {
      fitAfter: state.alignNorthUp,
    });
  });
}

// Кнопки редактирования контура
undoContourBtn.addEventListener('click', () => {
  performUndo();
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
  schedulePersist();
});

clearContourBtn.addEventListener('click', () => {
  if (state.vertices.length === 0) return;
  pushUndoSnapshot();
  state.vertices = [];
  state.selectedVertexIndex = -1;
  recomputeVastuMap();
  schedulePersist();
});

orthoSnapToggle.addEventListener('change', () => {
  state.orthoSnap = orthoSnapToggle.checked;
  schedulePersist();
});

// Переключатели слоёв и ориентации карты
toggleSectors.addEventListener('change', () => {
  state.layers.showSectors = toggleSectors.checked;
  syncInspectorUI();
  requestRender();
  schedulePersist();
});

toggleBrahmastan.addEventListener('change', () => {
  state.layers.showBrahmastan = toggleBrahmastan.checked;
  syncInspectorUI();
  requestRender();
  schedulePersist();
});

togglePadas.addEventListener('change', () => {
  state.layers.showPadas = togglePadas.checked;
  syncInspectorUI();
  requestRender();
  schedulePersist();
});

togglePadaBelts.addEventListener('change', () => {
  state.layers.showPadaBelts = togglePadaBelts.checked;
  requestRender();
  schedulePersist();
});

togglePadaScores.addEventListener('change', () => {
  state.layers.showPadaScores = togglePadaScores.checked;
  requestRender();
  schedulePersist();
});

orientNorthUpBtn.addEventListener('click', () => {
  if (state.alignNorthUp) return;
  state.alignNorthUp = true;
  syncInspectorUI();
  fitPlanToViewport();
  schedulePersist();
});

orientAsOnSheetBtn.addEventListener('click', () => {
  if (!state.alignNorthUp) return;
  state.alignNorthUp = false;
  syncInspectorUI();
  fitPlanToViewport();
  schedulePersist();
});

sectorOpacitySlider.addEventListener('input', () => {
  const pct = Number(sectorOpacitySlider.value) || 40;
  sectorOpacityValue.textContent = `${pct}%`;
  state.layers.sectorOpacity = pct / 100;
  requestRender();
  schedulePersist();
});

// ============================================================================
// Сохранение готовой карты: navigator.share({files}) -> скачивание -> удержание на экране
// ============================================================================
function dataUrlToBlobSync(dataUrl) {
  const parts = dataUrl.split(',');
  const mimeMatch = parts[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/png';
  const binary = atob(parts[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

function isEmbeddedMessengerWebView() {
  const ua = (navigator && navigator.userAgent) || '';
  return /Telegram|Instagram|VKAndroidApp|VKClient|\bVK\/|FBAN|FBAV|Line\//i.test(ua);
}

function showSaveConfirmation(message) {
  saveToastText.textContent = message;
  saveToast.hidden = false;
  if (saveToastTimer) clearTimeout(saveToastTimer);
  saveToastTimer = setTimeout(() => {
    saveToast.hidden = true;
  }, 5500);
}

function openImageHoldOverlay(dataUrl) {
  if (!dataUrl) return;
  previewModalImg.src = dataUrl;
  imagePreviewModal.hidden = false;
}

openSavedPreviewBtn.addEventListener('click', () => {
  if (lastExportDataUrl) {
    openImageHoldOverlay(lastExportDataUrl);
  }
});

function canShareFilesViaSheet(file) {
  if (
    typeof navigator === 'undefined' ||
    typeof navigator.canShare !== 'function' ||
    typeof navigator.share !== 'function'
  ) {
    return false;
  }

  let shareFnSource = '';
  try {
    shareFnSource = Function.prototype.toString.call(navigator.share);
  } catch {
    shareFnSource = '';
  }
  const isNativeShare = shareFnSource.includes('[native code]');
  const ua = (navigator && navigator.userAgent) || '';

  // В автоматизированном безголовом браузере нативный вызов системного меню ОС зависает без окна
  if (isNativeShare && (navigator.webdriver || /HeadlessChrome\//i.test(ua))) {
    return false;
  }

  // На телефоне и планшете открываем системное меню (на iPhone — «Сохранить изображение» в Фото),
  // а на настольном компьютере сразу скачиваем PNG-файл
  const isMobileOrTouch =
    /Android|iPhone|iPad|iPod|Mobile/i.test(ua) ||
    (typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 0);

  if (isNativeShare && !isMobileOrTouch) {
    return false;
  }

  try {
    return Boolean(navigator.canShare({ files: [file] }));
  } catch {
    return false;
  }
}

async function saveReadyMapPng() {
  if (!canExportVastuMap(state)) {
    if (!state.northSet) {
      statusBanner.textContent =
        'Сначала задайте Север во вкладке «План и север», чтобы скачать карту';
      setActiveTab('plan');
    } else {
      statusBanner.textContent =
        'Сначала замкните контур квартиры (минимум 3 угла) во вкладке «Контур стен»';
      setActiveTab('contour');
    }
    return;
  }

  const exportCanvas = exportMapToPngCanvas(state);
  if (!exportCanvas) return;

  const filename = buildExportFilename(new Date());
  const dataUrl = exportCanvas.toDataURL('image/png');
  lastExportDataUrl = dataUrl;
  const blob = dataUrlToBlobSync(dataUrl);
  const file = new File([blob], filename, { type: 'image/png' });

  // 1. На телефоне (или если navigator.share поддерживается для файлов): сохраняем через navigator.share
  try {
    if (canShareFilesViaSheet(file)) {
      await navigator.share({
        files: [file],
        title: 'Васту-карта квартиры',
      });
      showSaveConfirmation('Карта сохранена');
      return;
    }
  } catch (err) {
    if (err && err.name === 'AbortError') {
      return;
    }
    // Если share не сработал по ограничению браузера, переходим к запасному способу
  }

  // 2. Во встроенных браузерах Telegram / VK / Instagram скачивание блокируется — показываем картинку поверх экрана
  if (isEmbeddedMessengerWebView() || !('download' in HTMLAnchorElement.prototype)) {
    openImageHoldOverlay(dataUrl);
    showSaveConfirmation('Нажмите и удерживайте картинку, чтобы сохранить');
    return;
  }

  // 3. Обычное скачивание файла PNG
  try {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 6000);
    showSaveConfirmation(`Карта сохранена (${filename})`);
  } catch {
    openImageHoldOverlay(dataUrl);
    showSaveConfirmation('Нажмите и удерживайте картинку, чтобы сохранить');
  }
}

topExportBtn.addEventListener('click', saveReadyMapPng);
exportPngBtn.addEventListener('click', saveReadyMapPng);

// Клавиши быстрого управления (Cmd/Ctrl+Z для отмены и Escape для закрытия окон)
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!confirmModal.hidden) {
      closeConfirmModal(false);
      return;
    }
    if (!imagePreviewModal.hidden) {
      imagePreviewModal.hidden = true;
      return;
    }
  }

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    if (state.undoHistory.length > 0 && confirmModal.hidden) {
      e.preventDefault();
      performUndo();
    }
  }
});

const resizeObserver = new ResizeObserver(() => {
  if (isViewingSatelliteCanvas()) {
    fitSatelliteToViewport();
  } else {
    fitPlanToViewport();
  }
});
resizeObserver.observe(canvasStage);

// ============================================================================
// Инициализация и восстановление сохранённой работы ученицы
// ============================================================================
async function restoreOrInit() {
  const saved = await loadWorkspaceSession();
  if (saved && Array.isArray(saved.vertices)) {
    try {
      if (saved.isSamplePlan) {
        const sample = createSampleFloorPlan();
        state.isSamplePlan = true;
        state.sampleModified = Boolean(saved.sampleModified);
        state.basePlanCanvas = sample.canvas;
        cachedBasePlanDataUrl = null;
      } else if (saved.basePlanDataUrl) {
        const restoredBase = await restorePlanCanvasFromDataUrl(
          saved.basePlanDataUrl,
          saved.basePlanWidth,
          saved.basePlanHeight
        );
        state.isSamplePlan = false;
        state.sampleModified = false;
        state.basePlanCanvas = restoredBase;
        cachedBasePlanDataUrl = saved.basePlanDataUrl;
      } else {
        throw new Error('Missing saved plan image');
      }

      state.sheetQuarterTurns = ((saved.sheetQuarterTurns || 0) % 4 + 4) % 4;
      state.planCanvas =
        state.sheetQuarterTurns === 0
          ? state.basePlanCanvas
          : rotatePlanCanvas(state.basePlanCanvas, state.sheetQuarterTurns);
      state.planWidth = state.planCanvas.width;
      state.planHeight = state.planCanvas.height;
      state.planTitle = saved.planTitle || 'План квартиры';

      state.vertices = clonePointList(saved.vertices);
      state.undoHistory.clear();
      state.selectedVertexIndex = -1;

      state.northSet = Boolean(saved.northSet && Number.isFinite(saved.northAngleDeg));
      state.northAngleDeg = state.northSet ? normalizeDeg(saved.northAngleDeg) : null;
      lastValidNorthInput = state.northSet
        ? String(Math.round(state.northAngleDeg * 10) / 10)
        : '';

      state.alignNorthUp =
        typeof saved.alignNorthUp === 'boolean' ? saved.alignNorthUp : true;
      state.orthoSnap =
        typeof saved.orthoSnap === 'boolean' ? saved.orthoSnap : true;

      if (saved.layers && typeof saved.layers === 'object') {
        state.layers = {
          showSectors: Boolean(saved.layers.showSectors ?? true),
          showBrahmastan: Boolean(saved.layers.showBrahmastan ?? true),
          showPadas: Boolean(saved.layers.showPadas ?? false),
          showPadaBelts: Boolean(saved.layers.showPadaBelts ?? false),
          showPadaScores: Boolean(saved.layers.showPadaScores ?? false),
          sectorOpacity:
            typeof saved.layers.sectorOpacity === 'number'
              ? saved.layers.sectorOpacity
              : 0.4,
        };
      }

      const restoredTab =
        saved.activeTab && tabPanes[saved.activeTab] ? saved.activeTab : 'layers';
      recomputeVastuMap();
      setActiveTab(restoredTab);
      fitPlanToViewport();
      return;
    } catch {
      // Если сохранённые данные повреждены, мягко открываем учебный пример
    }
  }

  openSamplePlan();
  setActiveTab('layers');
}

// Поздно пришедший шрифт НЕ заменяет работу ученицы учебным планом — только перерисовывает!
function setupFontReadyRedraw() {
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      if (state.isSamplePlan && state.basePlanCanvas) {
        const refreshed = createSampleFloorPlan();
        state.basePlanCanvas = refreshed.canvas;
        state.planCanvas =
          state.sheetQuarterTurns === 0
            ? state.basePlanCanvas
            : rotatePlanCanvas(state.basePlanCanvas, state.sheetQuarterTurns);
      }
      requestRender();
    });
  }
}

restoreOrInit().then(() => {
  setupFontReadyRedraw();
});

// Экспорт ссылки на состояние для автопроверок
window.__vastuApp = {
  state,
  setNorthAngle,
  setActiveTab,
  fitPlanToViewport,
  performUndo,
  exportMapToPngCanvas: () => exportMapToPngCanvas(state),
};
