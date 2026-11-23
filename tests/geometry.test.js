import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDeg,
  azimuthToUnitVector,
  vectorToAzimuthDeg,
  signedAngleDeltaDeg,
  northAngleFromWallSegments,
  houseTiltFromSatelliteWall,
  polygonArea,
  computePolygonCenter,
  isPointInPolygon,
  pointToSegmentDistance,
  hasSelfIntersection,
  extractPiecesBoundaryLoops,
  computeAxes,
  computeSectors,
  getSectorForPoint,
  getPadaForPoint,
  computePadaGrid,
  buildVastuMap,
  CENTER_OUTSIDE_NOTE,
  BRAHMASTAN_CLIPPED_NOTE,
  BRAHMASTAN_CLIPPED_BADGE,
} from '../src/geometry.js';
import {
  MIN_WALL_SEGMENT_SCREEN_PX,
  MIN_NEW_CORNER_DIST_PX,
  STEP_LOCKED_CAPTION,
  computeStepsState,
  normalizeRestoredDraft,
  applySheetRotation90CW,
  createUndoHistory,
  applyUndoEntry,
  computePlanViewRotationDeg,
  resolvePlanTabHitAction,
  isWallSegmentLongEnoughOnScreen,
  classifyContourTapProximity,
  applyOrthoSnapPoint,
  formatHouseTiltLine,
  detectExportPlatform,
  buildExportFilename,
  canExportVastuMap,
  createDefaultLayers,
  restoreSavedLayers,
  resetWorkspaceState,
} from '../src/state-helpers.js';
import { clearWorkspaceSession } from '../src/storage.js';
import { exportMapToPngCanvas } from '../src/renderer.js';

function approxEqual(actual, expected, eps = 1e-6, msg = '') {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `${msg ? msg + ': ' : ''}ожидалось ${expected}, получено ${actual} (разница ${Math.abs(actual - expected)})`
  );
}

test('Центр прямоугольной квартиры совпадает с пересечением диагоналей', () => {
  const rect = [
    { x: 120, y: 80 },
    { x: 520, y: 80 },
    { x: 520, y: 380 },
    { x: 120, y: 380 },
  ];

  const center = computePolygonCenter(rect);
  assert.ok(center);
  approxEqual(center.x, 320, 1e-9, 'center.x');
  approxEqual(center.y, 230, 1e-9, 'center.y');
  approxEqual(polygonArea(rect), 400 * 300, 1e-6, 'площадь прямоугольника');

  const rectReversedWithMidpoint = [
    { x: 120, y: 80 },
    { x: 120, y: 380 },
    { x: 320, y: 380 },
    { x: 520, y: 380 },
    { x: 520, y: 80 },
  ];
  const center2 = computePolygonCenter(rectReversedWithMidpoint);
  approxEqual(center2.x, 320, 1e-9, 'center2.x');
  approxEqual(center2.y, 230, 1e-9, 'center2.y');
});

test('Центр Г-образной квартиры совпадает с расчётом по двум прямоугольникам (метод С. А. Балуты)', () => {
  const lShape = [
    { x: 0, y: 0 },
    { x: 6, y: 0 },
    { x: 6, y: 6 },
    { x: 12, y: 6 },
    { x: 12, y: 10 },
    { x: 0, y: 10 },
  ];

  const area = polygonArea(lShape);
  approxEqual(area, 84, 1e-9, 'площадь Г-образной квартиры');

  const center = computePolygonCenter(lShape);
  assert.ok(center);
  approxEqual(center.x, 33 / 7, 1e-9, 'Cx Г-образной квартиры');
  approxEqual(center.y, 41 / 7, 1e-9, 'Cy Г-образной квартиры');
  assert.equal(isPointInPolygon(center, lShape), true);

  const shiftedReversed = [...lShape.slice(3), ...lShape.slice(0, 3)].reverse();
  const centerRev = computePolygonCenter(shiftedReversed);
  approxEqual(centerRev.x, 33 / 7, 1e-9);
  approxEqual(centerRev.y, 41 / 7, 1e-9);
});

test('Расчёт Севера и угла поворота дома (±45° по модулю 90°) по двум отрезкам стены', () => {
  const satW2E_1 = { x: 100, y: 200 };
  const satW2E_2 = { x: 300, y: 200 };
  const planL2R_1 = { x: 50, y: 80 };
  const planL2R_2 = { x: 450, y: 80 };
  approxEqual(
    northAngleFromWallSegments(satW2E_1, satW2E_2, planL2R_1, planL2R_2),
    0,
    1e-9,
    'Стена параллельна на снимке и плане -> Север 0°'
  );
  approxEqual(houseTiltFromSatelliteWall(satW2E_1, satW2E_2), 0, 1e-9);
  assert.equal(
    formatHouseTiltLine(houseTiltFromSatelliteWall(satW2E_1, satW2E_2)),
    'Дом повёрнут на 0° относительно сторон света'
  );

  // Если перепутать порядок точек 1 и 2 ТОЛЬКО на плане (отметить 2 -> 1), Север меняется ровно на 180°
  approxEqual(
    northAngleFromWallSegments(satW2E_1, satW2E_2, planL2R_2, planL2R_1),
    180,
    1e-9,
    'Смена порядка точек 1 и 2 на плане разворачивает Север ровно на 180°'
  );

  // Если поменять местами 1 и 2 и на спутнике, и на плане одновременно — угол Севера сохраняется
  approxEqual(
    northAngleFromWallSegments(satW2E_2, satW2E_1, planL2R_2, planL2R_1),
    0,
    1e-9
  );

  // Дом на спутнике повёрнут на +22° по часовой стрелке: стена идёт под азимутом 112°
  const dir112 = azimuthToUnitVector(112);
  const satTilted1 = { x: 200, y: 200 };
  const satTilted2 = { x: 200 + dir112.x * 150, y: 200 + dir112.y * 150 };
  const computedNorth = northAngleFromWallSegments(
    satTilted1,
    satTilted2,
    planL2R_1,
    planL2R_2
  );
  approxEqual(computedNorth, 338, 1e-6, 'Дом под углом +22° на спутнике -> Север 338° на листе');

  // Угол поворота дома по модулю 90° одинаков для любой из 4 перпендикулярных стен и при обратном порядке 1↔2
  approxEqual(houseTiltFromSatelliteWall(satTilted1, satTilted2), 22, 1e-6);
  approxEqual(houseTiltFromSatelliteWall(satTilted2, satTilted1), 22, 1e-6);
  const dir202 = azimuthToUnitVector(202);
  approxEqual(
    houseTiltFromSatelliteWall(
      { x: 0, y: 0 },
      { x: dir202.x * 120, y: dir202.y * 120 }
    ),
    22,
    1e-6
  );
  assert.equal(
    formatHouseTiltLine(houseTiltFromSatelliteWall(satTilted1, satTilted2)),
    'Дом повёрнут на 22° относительно сторон света'
  );

  // Отрицательный поворот (-18°: стена под азимутом 72°)
  const dir72 = azimuthToUnitVector(72);
  const tiltNeg = houseTiltFromSatelliteWall(
    { x: 0, y: 0 },
    { x: dir72.x * 120, y: dir72.y * 120 }
  );
  approxEqual(tiltNeg, -18, 1e-6);
  assert.equal(formatHouseTiltLine(tiltNeg), 'Дом повёрнут на −18° относительно сторон света');

  const computedFlipped = northAngleFromWallSegments(
    satTilted2,
    satTilted1,
    planL2R_1,
    planL2R_2
  );
  approxEqual(computedFlipped, normalizeDeg(computedNorth + 180), 1e-6);

  assert.equal(
    northAngleFromWallSegments(satW2E_1, satW2E_1, planL2R_1, planL2R_2),
    null
  );
  assert.equal(houseTiltFromSatelliteWall(satW2E_1, satW2E_1), null);

  approxEqual(signedAngleDeltaDeg(355, 10), 15, 1e-9);
  approxEqual(signedAngleDeltaDeg(10, 355), -15, 1e-9);
});

test('Углы 8 секторов относительно произвольного Севера и отсутствие секторов, пока Север не задан', () => {
  const lShape = [
    { x: 100, y: 100 },
    { x: 460, y: 100 },
    { x: 460, y: 340 },
    { x: 700, y: 340 },
    { x: 700, y: 580 },
    { x: 100, y: 580 },
  ];
  const totalArea = polygonArea(lShape);
  const center = computePolygonCenter(lShape);

  const mapWithoutNorth = buildVastuMap(lShape, null);
  assert.ok(mapWithoutNorth);
  assert.equal(mapWithoutNorth.northSet, false);
  assert.equal(mapWithoutNorth.northAngleDeg, null);
  assert.equal(mapWithoutNorth.sectors.length, 0);
  assert.equal(mapWithoutNorth.padaGrid, null);

  for (const northDeg of [0, 21, 33.5, 90, 145, 278.25, 359.5]) {
    const sectors = computeSectors(lShape, center, northDeg);
    assert.equal(sectors.length, 8);

    const northSector = sectors.find((s) => s.code === 'С');
    approxEqual(northSector.centerPlanDeg, normalizeDeg(northDeg), 1e-9);
    approxEqual(northSector.startPlanDeg, normalizeDeg(northDeg - 22.5), 1e-9);
    approxEqual(northSector.endPlanDeg, normalizeDeg(northDeg + 22.5), 1e-9);

    const swSector = sectors.find((s) => s.code === 'ЮЗ');
    approxEqual(swSector.centerPlanDeg, normalizeDeg(northDeg + 225), 1e-9);

    const sumArea = sectors.reduce((acc, s) => acc + s.area, 0);
    approxEqual(sumArea, totalArea, 1e-3, `Сумма секторов при Севере ${northDeg}°`);

    for (const s of sectors) {
      const dir = azimuthToUnitVector(s.centerPlanDeg);
      const probe = { x: center.x + dir.x * 50, y: center.y + dir.y * 50 };
      const detected = getSectorForPoint(probe, center, northDeg);
      assert.equal(detected.code, s.code);
    }
  }
});

test('Брахмастан по форме квартиры: чистый внешний контур без внутренних швов треугольников и пометка обрезки стеной', () => {
  // 1) Обычная Г-образная квартира: Брахмастан целиком внутри стен (1/9 площади)
  const regularL = [
    { x: 0, y: 0 },
    { x: 80, y: 0 },
    { x: 80, y: 50 },
    { x: 120, y: 50 },
    { x: 120, y: 100 },
    { x: 0, y: 100 },
  ];
  const map1 = buildVastuMap(regularL, 0);
  assert.equal(map1.centerInside, true);
  assert.equal(map1.centerOutsideOrClipped, false);
  assert.equal(map1.centerNote, null);
  assert.equal(map1.brahmastanClippedByWall, false);
  assert.equal(map1.brahmastanClippedNote, null);
  approxEqual(map1.brahmastan.area, polygonArea(regularL) / 9, 1e-5);
  assert.equal(map1.brahmastan.wasClipped, false);
  assert.equal(map1.brahmastan.outlineLoops.length, 1);

  // 2) Несимметричная Г-образная квартира: Брахмастан обрезан стеной (wasClipped = true),
  //    причём его внешний контур собирается в единый замкнутый многоугольник без внутренних швов треугольников!
  const partialClipL = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 40 },
    { x: 15, y: 40 },
    { x: 15, y: 120 },
    { x: 0, y: 120 },
  ];
  const map2 = buildVastuMap(partialClipL, 0);
  const bs2 = map2.brahmastan;
  assert.equal(map2.centerInside, true, 'Центр несимметричной Г-квартиры лежит внутри стен');
  assert.equal(bs2.wasClipped, true, 'Выступающий угол Брахмастана отсечён');
  assert.equal(map2.brahmastanClippedByWall, true, 'Включён признак обрезанного стеной Брахмастана');
  assert.equal(map2.brahmastanClippedNote, BRAHMASTAN_CLIPPED_NOTE);
  assert.equal(map2.brahmastanClippedBadge, BRAHMASTAN_CLIPPED_BADGE);
  assert.ok(bs2.area > 0, 'Оставшаяся внутри стен площадь Брахмастана строго больше нуля');
  assert.ok(bs2.area < bs2.rawArea, 'Отсечённая площадь меньше расчётной 1/9');

  // Проверяем, что вместо 6 отдельных кусков-треугольников со швами строится 1 внешний контур той же площади
  assert.ok(bs2.pieces.length >= 4, 'Исходно Брахмастан состоит из нескольких треугольных кусков');
  assert.equal(bs2.outlineLoops.length, 1, 'Внешний контур склеен в один замкнутый полигон без внутренних швов');
  approxEqual(
    polygonArea(bs2.outlineLoops[0]),
    bs2.area,
    1e-4,
    'Площадь внешнего контура в точности равна суммарной площади кусков Брахмастана'
  );
  // Ни одно ребро внешнего контура не проходит через внутренний центр Брахмабинду
  for (const pt of bs2.outlineLoops[0]) {
    const distToCenter = Math.hypot(pt.x - map2.center.x, pt.y - map2.center.y);
    assert.ok(distToCenter > 1, 'Внешний контур не заходит во внутреннюю вершину веера треугольников');
    assert.equal(isPointInPolygon(pt, partialClipL), true);
  }

  // Также проверим extractPiecesBoundaryLoops напрямую на двух смежных треугольниках квадрата
  const twoTriangles = [
    [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
    ],
    [
      { x: 0, y: 0 },
      { x: 40, y: 40 },
      { x: 0, y: 40 },
    ],
  ];
  const sqLoops = extractPiecesBoundaryLoops(twoTriangles);
  assert.equal(sqLoops.length, 1);
  assert.equal(sqLoops[0].length, 4, 'Диагональный шов двух треугольников полностью удалён');
  approxEqual(polygonArea(sqLoops[0]), 1600, 1e-6);

  // 3) Узкий Г-образный уголок (thinCornerL): центр вне стен, а отсечённый Брахмастан имеет нулевую площадь
  const thinCornerL = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 18 },
    { x: 18, y: 18 },
    { x: 18, y: 100 },
    { x: 0, y: 100 },
  ];
  const mapThin = buildVastuMap(thinCornerL, 15);
  assert.equal(mapThin.centerInside, false);
  approxEqual(mapThin.brahmastan.area, 0, 1e-6);
  assert.equal(mapThin.brahmastan.isEmpty, true);
  assert.equal(mapThin.centerOutsideOrClipped, true);
  assert.equal(mapThin.centerNote, CENTER_OUTSIDE_NOTE);

  // 4) П-образная квартира: центр во внутреннем дворе вне стен
  const uShape = [
    { x: 0, y: 0 },
    { x: 120, y: 0 },
    { x: 120, y: 100 },
    { x: 95, y: 100 },
    { x: 95, y: 22 },
    { x: 25, y: 22 },
    { x: 25, y: 100 },
    { x: 0, y: 100 },
  ];
  const mapU = buildVastuMap(uShape, 0);
  assert.equal(mapU.centerInside, false);
  assert.equal(mapU.centerOutsideOrClipped, true);
  assert.equal(mapU.centerNote, 'Центр вне стен — покажите эту карту Анне');
});

test('Пункт 1: отмена правки контура трогает ТОЛЬКО углы контура (Север и точки стены прежние), а отмена поворота листа возвращает всё вместе', () => {
  const history = createUndoHistory();

  // Ученица загрузила свой план (Север ещё не задан) и поставила 4 угла + 1 лишний 5-й угол
  const corners4 = [
    { x: 100, y: 120 },
    { x: 520, y: 120 },
    { x: 520, y: 420 },
    { x: 100, y: 420 },
  ];
  const corners5WithExtra = [
    ...corners4,
    { x: 80, y: 270 }, // лишний 5-й угол
  ];

  // Шаги обводки записались ДО того, как ученица задала Север!
  history.pushContour([]);
  history.pushContour(corners4.slice(0, 1));
  history.pushContour(corners4.slice(0, 2));
  history.pushContour(corners4.slice(0, 3));
  history.pushContour(corners4); // снимок перед добавлением лишнего 5-го угла

  // Затем ученица перешла во вкладку «Север» и задала Север по спутнику ПОСЛЕ обводки контура
  const currentAfterNorth = {
    sheetQuarterTurns: 0,
    planWidth: 1000,
    planHeight: 700,
    vertices: corners5WithExtra,
    satPlanPts: [
      { x: 100, y: 120 },
      { x: 520, y: 120 },
    ],
    satSatPts: [
      { x: 220, y: 180 },
      { x: 480, y: 260 },
    ],
    northSet: true,
    northAngleDeg: 338,
  };

  // Ученица возвращается в «Контур стен» и нажимает «Отменить» на лишнем 5-м угле
  const entry = history.pop();
  assert.equal(entry.kind, 'contour');
  const afterContourUndo = applyUndoEntry(currentAfterNorth, entry);

  assert.deepEqual(afterContourUndo.vertices, corners4, 'Лишний угол отменён, остались 4 угла');
  assert.equal(afterContourUndo.northSet, true, 'Север НЕ стёрся при отмене угла');
  approxEqual(afterContourUndo.northAngleDeg, 338, 1e-9, 'Угол Севера НЕ откатился и НЕ перевернулся');
  assert.deepEqual(afterContourUndo.satPlanPts, currentAfterNorth.satPlanPts, 'Точки стены на плане прежние');
  assert.deepEqual(afterContourUndo.satSatPts, currentAfterNorth.satSatPts, 'Точки стены на спутнике прежние');

  // Даже если дальше был прежний Север (например 158°), а потом ученица поправила Север на 338° и нажала «Отменить» угла:
  history.pushContour(corners4);
  const stateWithEditedCornerAndNewNorth = {
    ...afterContourUndo,
    vertices: [...corners4, { x: 300, y: 430 }],
    northSet: true,
    northAngleDeg: 338,
  };
  const afterSecondContourUndo = applyUndoEntry(stateWithEditedCornerAndNewNorth, history.pop());
  assert.deepEqual(afterSecondContourUndo.vertices, corners4);
  assert.equal(afterSecondContourUndo.northSet, true);
  approxEqual(afterSecondContourUndo.northAngleDeg, 338, 1e-9);

  // Теперь проверяем «Повернуть лист на 90°» и его отмену: лист, контур, точки плана и Север возвращаются ВМЕСТЕ!
  history.pushSheetRotate(afterContourUndo);
  const rotatedState = {
    ...applySheetRotation90CW(afterContourUndo),
    satSatPts: afterContourUndo.satSatPts,
  };
  assert.equal(rotatedState.sheetQuarterTurns, 1);
  assert.equal(rotatedState.planWidth, 700);
  assert.equal(rotatedState.planHeight, 1000);
  approxEqual(rotatedState.northAngleDeg, normalizeDeg(338 + 90), 1e-9);

  const rotateUndoEntry = history.pop();
  assert.equal(rotateUndoEntry.kind, 'sheet-rotate');
  const restoredFromRotate = applyUndoEntry(rotatedState, rotateUndoEntry);

  assert.equal(restoredFromRotate.turnsChanged, true);
  assert.equal(restoredFromRotate.sheetQuarterTurns, 0);
  assert.equal(restoredFromRotate.planWidth, 1000);
  assert.equal(restoredFromRotate.planHeight, 700);
  assert.equal(restoredFromRotate.northSet, true);
  approxEqual(restoredFromRotate.northAngleDeg, 338, 1e-9);
  assert.deepEqual(restoredFromRotate.vertices, corners4);
  assert.deepEqual(restoredFromRotate.satPlanPts, currentAfterNorth.satPlanPts);
  assert.deepEqual(restoredFromRotate.satSatPts, currentAfterNorth.satSatPts);
});

test('Пункт 2: на шаге «2. Север» ручного поворота «С» нет, в «Проверке «С»» точки «1» и «2» только для показа, а поворот экрана заморожен на всё время жеста', () => {
  // 1) Ни в каком режиме нет ручного поворота стрелки «С» (rotate-north удалён)
  assert.deepEqual(
    resolvePlanTabHitAction({
      satViewMode: 'idle',
      hitPlanWallPointIndex: -1,
    }),
    { action: 'pan-or-tap', pointIndex: -1 }
  );

  // 2) В виде «Проверка «С»» (satViewMode === 'done', план повёрнут севером вверх) точки «1» и «2» ТОЛЬКО для показа:
  //    касание по ним НЕ запускает перетаскивание и не уводит Север!
  assert.deepEqual(
    resolvePlanTabHitAction({
      satViewMode: 'done',
      hitPlanWallPointIndex: 0,
    }),
    { action: 'pan-or-tap', pointIndex: -1 },
    'В виде Проверка «С» точки 1 и 2 не перетаскиваются'
  );

  // 3) На этапе отметки на плане (satViewMode === 'plan-pick') лист НЕ повёрнут (0°), и точки «1» и «2» доступны для поправки
  assert.deepEqual(
    resolvePlanTabHitAction({
      satViewMode: 'plan-pick',
      hitPlanWallPointIndex: 1,
    }),
    { action: 'drag-plan-wall-pt', pointIndex: 1 }
  );
  approxEqual(
    computePlanViewRotationDeg({
      activeTab: 'north',
      satViewMode: 'plan-pick',
      northSet: true,
      northAngleDeg: 62,
      alignNorthUp: true,
      frozenRotationDeg: null,
    }),
    0,
    1e-9,
    'При отметке точек на плане лист не повёрнут'
  );

  // 4) Во время любого жеста перетаскивания поворот экрана заморожен (frozenRotationDeg = -62°)
  approxEqual(
    computePlanViewRotationDeg({
      activeTab: 'north',
      satViewMode: 'done',
      northSet: true,
      northAngleDeg: 95,
      alignNorthUp: true,
      frozenRotationDeg: -62,
    }),
    -62,
    1e-9,
    'Во время жеста экран держит замороженный поворот -62°, не вращаясь под пальцем'
  );
  approxEqual(
    computePlanViewRotationDeg({
      activeTab: 'north',
      satViewMode: 'done',
      northSet: true,
      northAngleDeg: 95,
      alignNorthUp: true,
      frozenRotationDeg: null,
    }),
    -95,
    1e-9,
    'После завершения жеста план встаёт по новому Северу (-95°)'
  );
});

test('Пункты 3 и 7: минимальная длина стены 100 px и разделение Android / iPhone при сохранении', () => {
  // Пункт 3: отрезок стены короче 100 экранных px отклоняется и на спутнике, и на плане
  assert.equal(MIN_WALL_SEGMENT_SCREEN_PX, 100);
  assert.equal(
    isWallSegmentLongEnoughOnScreen({ x: 100, y: 100 }, { x: 130, y: 100 }),
    false,
    'Стена 30 px слишком короткая — отклоняем'
  );
  assert.equal(
    isWallSegmentLongEnoughOnScreen({ x: 100, y: 100 }, { x: 199, y: 100 }),
    false,
    'Стена 99 px короче порога 100 px — отклоняем'
  );
  assert.equal(
    isWallSegmentLongEnoughOnScreen({ x: 100, y: 100 }, { x: 200, y: 100 }),
    true,
    'Стена 100 px принимается'
  );
  assert.equal(
    isWallSegmentLongEnoughOnScreen({ x: 50, y: 60 }, { x: 170, y: 140 }),
    true,
    'Стена ~144 px принимается'
  );

  // Пункт 7: Android скачивает файл по «Скачать карту», iPhone открывает системное меню «Поделиться»
  const androidChrome = detectExportPlatform({
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
    platform: 'Linux armv8l',
    maxTouchPoints: 5,
  });
  assert.equal(androidChrome.isAndroid, true);
  assert.equal(androidChrome.isIOS, false);
  assert.equal(
    androidChrome.preferShareSheetOnDownload,
    false,
    'На Android «Скачать карту» скачивает файл напрямую, не подменяя его окном Поделиться'
  );

  const iphoneSafari = detectExportPlatform({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    platform: 'iPhone',
    maxTouchPoints: 5,
  });
  assert.equal(iphoneSafari.isIOS, true);
  assert.equal(iphoneSafari.preferShareSheetOnDownload, true);

  const ipadOS = detectExportPlatform({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    platform: 'MacIntel',
    maxTouchPoints: 5,
  });
  assert.equal(ipadOS.isIOS, true);
  assert.equal(ipadOS.preferShareSheetOnDownload, true);

  const telegramIOS = detectExportPlatform({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Telegram/10.5',
    platform: 'iPhone',
    maxTouchPoints: 5,
  });
  assert.equal(telegramIOS.isEmbeddedMessenger, true);
  assert.equal(telegramIOS.preferShareSheetOnDownload, false);
});

test('Пункт 9: короткие стены и квартира с лоджией — касание дальше 11 px добавляет угол, выравнивание 90° не схлопывает торец лоджии', () => {
  assert.equal(MIN_NEW_CORNER_DIST_PX, 11);

  const existingScreenCorners = [
    { x: 100, y: 100 },
    { x: 260, y: 100 },
    { x: 260, y: 116 }, // короткий торец лоджии всего 16 px на экране (внутри прежнего радиуса 26 px!)
  ];

  // Новое касание в 16 px от предыдущего угла (короткая стена лоджии) ДОБАВЛЯЕТ угол, а не теряется!
  const tapShortWall = classifyContourTapProximity(
    { x: 244, y: 116 },
    existingScreenCorners
  );
  assert.equal(tapShortWall.action, 'add', 'Касание на расстоянии 16 px добавляет новый угол короткой стены');

  // Слишком близкое касание (7 px от существующего угла) возвращает too-close для подсказки «приблизьте план»
  const tapTooClose = classifyContourTapProximity(
    { x: 265, y: 112 },
    existingScreenCorners
  );
  assert.equal(tapTooClose.action, 'too-close');

  // Помощник прямого угла 90° выравнивает микроскопический перекос по X (2 px),
  // но НЕ схлопывает короткую 14-пиксельную вертикальную стену торца лоджии в предыдущую точку!
  const snappedShortLedge = applyOrthoSnapPoint(
    { x: 262, y: 114 },
    [{ x: 260, y: 100 }],
    1,
    true
  );
  assert.deepEqual(
    snappedShortLedge,
    { x: 260, y: 114 },
    'Короткий вертикальный торец лоджии (14 px) выровнен под 90°, но сохранил свою длину'
  );

  // Квартира с выступающей застеклённой лоджией и короткими боковыми простенками (по 14 ед. при ширине квартиры 420 ед.)
  const apartmentWithLoggia = [
    { x: 0, y: 14 },
    { x: 150, y: 14 },
    { x: 150, y: 0 },   // короткий левый торец лоджии (длина 14)
    { x: 310, y: 0 },   // фасад остекления лоджии
    { x: 310, y: 14 },  // короткий правый торец лоджии (длина 14)
    { x: 420, y: 14 },
    { x: 420, y: 280 },
    { x: 0, y: 280 },
  ];

  // Прогоняем последовательную обводку всех 8 углов квартиры с лоджией с включённым 90° выравниванием
  const tracedVertices = [];
  for (const rawCorner of apartmentWithLoggia) {
    // Имитируем небольшую погрешность пальца ±1.5 px на каждом углу, в том числе на коротких торцах лоджии
    const noisy = { x: rawCorner.x + 1.2, y: rawCorner.y - 0.9 };
    if (tracedVertices.length > 0) {
      const prox = classifyContourTapProximity(noisy, tracedVertices);
      assert.equal(prox.action, 'add', 'Ни один угол лоджии не должен блокироваться соседним углом');
    }
    const prev = tracedVertices[tracedVertices.length - 1];
    const snapped = applyOrthoSnapPoint(noisy, prev ? [prev] : [], 1, true);
    tracedVertices.push(snapped);
  }

  assert.equal(tracedVertices.length, 8, 'Все 8 углов квартиры с лоджией сохранены');
  assert.equal(hasSelfIntersection(tracedVertices), false, 'Контур квартиры с лоджией без самопересечений');

  const loggiaMap = buildVastuMap(apartmentWithLoggia, 18);
  assert.ok(loggiaMap);
  const expectedArea = 420 * (280 - 14) + (310 - 150) * 14;
  approxEqual(loggiaMap.area, expectedArea, 1e-6, 'Площадь квартиры вместе с лоджией');
  assert.equal(loggiaMap.centerInside, true);
  assert.equal(loggiaMap.sectors.length, 8);
  assert.equal(loggiaMap.padaGrid.padas.length, 32);
});

test('Имя файла сохранения и запрет сохранения без контура или Севера по спутнику', () => {
  assert.equal(
    buildExportFilename(new Date(2026, 10, 15)),
    'karta-kvartiry-2026-11-15.png'
  );
  assert.equal(
    buildExportFilename(new Date(2026, 2, 5)),
    'karta-kvartiry-2026-03-05.png'
  );

  const validVertices = [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 200 },
    { x: 0, y: 200 },
  ];
  const map = buildVastuMap(validVertices, 40);

  assert.equal(
    canExportVastuMap({
      planCanvas: {},
      northSet: false,
      northAngleDeg: null,
      vertices: validVertices,
      vastuMap: buildVastuMap(validVertices, null),
    }),
    false
  );
  assert.equal(
    canExportVastuMap({
      planCanvas: {},
      northSet: true,
      northSource: 'manual',
      northAngleDeg: 40,
      vertices: validVertices,
      vastuMap: map,
    }),
    false,
    'Ручной источник Севера не допускается к экспорту'
  );
  assert.equal(
    canExportVastuMap({
      planCanvas: {},
      northSet: true,
      northSource: 'satellite',
      northAngleDeg: 40,
      vertices: validVertices.slice(0, 2),
      vastuMap: null,
    }),
    false
  );
  assert.equal(
    canExportVastuMap({
      planCanvas: {},
      northSet: true,
      northSource: 'satellite',
      northAngleDeg: 40,
      vertices: validVertices,
      vastuMap: map,
    }),
    true
  );
});

test('Сетка пад: 32 радиальные пады по 11,25°, нумерация С. А. Балуты и концентрические пояса', () => {
  const poly = [
    { x: 50, y: 50 },
    { x: 450, y: 50 },
    { x: 450, y: 260 },
    { x: 620, y: 260 },
    { x: 620, y: 480 },
    { x: 50, y: 480 },
  ];
  const northDeg = 24;
  const map = buildVastuMap(poly, northDeg);
  assert.ok(map);

  const { padaGrid } = map;
  assert.equal(padaGrid.padas.length, 32);

  const p1 = padaGrid.padas.find((p) => p.number === 1);
  const p9 = padaGrid.padas.find((p) => p.number === 9);
  const p17 = padaGrid.padas.find((p) => p.number === 17);
  const p25 = padaGrid.padas.find((p) => p.number === 25);
  const p32 = padaGrid.padas.find((p) => p.number === 32);

  approxEqual(p1.centerAzimuth, 90, 1e-9);
  approxEqual(p9.centerAzimuth, 180, 1e-9);
  approxEqual(p17.centerAzimuth, 270, 1e-9);
  approxEqual(p25.centerAzimuth, 0, 1e-9);
  approxEqual(p32.centerAzimuth, 78.75, 1e-9);
  assert.equal(p32.score, 5);
  assert.equal(padaGrid.padas.find((p) => p.number === 24).score, 4);
  assert.equal(p9.score, -5);

  approxEqual(p25.centerPlanDeg, normalizeDeg(northDeg), 1e-9);
  approxEqual(p1.centerPlanDeg, normalizeDeg(northDeg + 90), 1e-9);

  const sumPadaAreas = padaGrid.padas.reduce((acc, p) => acc + p.area, 0);
  approxEqual(sumPadaAreas, map.area, 1e-2, 'Сумма площадей 32 пад');

  const northRayDir = azimuthToUnitVector(northDeg);
  const northPoint = {
    x: map.center.x + northRayDir.x * 100,
    y: map.center.y + northRayDir.y * 100,
  };
  assert.equal(getPadaForPoint(northPoint, map.center, northDeg).number, 25);

  const rect = [
    { x: 0, y: 0 },
    { x: 180, y: 0 },
    { x: 180, y: 90 },
    { x: 0, y: 90 },
  ];
  const rectGrid = computePadaGrid(rect, null, 0);
  const rectArea = polygonArea(rect);
  approxEqual(rectGrid.belts[0].area, rectArea / 81, 1e-5, 'Пояс 1/9 (Брахмабинду)');
  approxEqual(rectGrid.belts[1].area, rectArea / 9, 1e-5, 'Пояс 3/9 (Брахмастан)');
  approxEqual(rectGrid.belts[2].area, (rectArea * 25) / 81, 1e-5, 'Пояс 5/9 (Дева)');
  approxEqual(rectGrid.belts[3].area, (rectArea * 49) / 81, 1e-5, 'Пояс 7/9 (Манушья)');
});

test('Обнаружение самопересекающегося контура («песочные часы»)', () => {
  const validQuad = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];
  const bowtie = [
    { x: 0, y: 0 },
    { x: 100, y: 100 },
    { x: 100, y: 0 },
    { x: 0, y: 100 },
  ];
  assert.equal(hasSelfIntersection(validQuad), false);
  assert.equal(hasSelfIntersection(bowtie), true);
});

test('Задача 19 (п. 1): по умолчанию подписи секторов выключены, переключатель сохраняется в черновике', () => {
  const defaults = createDefaultLayers();
  assert.equal(
    defaults.showSectorLabels,
    false,
    'По умолчанию длинные подписи секторов на карте выключены'
  );
  assert.equal(defaults.showAxes, true, 'По умолчанию оси сторон света включены');
  assert.equal(defaults.showSectors, true);
  assert.equal(defaults.showBrahmastan, true);
  assert.equal(defaults.showPadas, false);

  // Восстановление пустого или старого черновика без поля showSectorLabels оставляет подписи выключенными
  assert.equal(restoreSavedLayers(null).showSectorLabels, false);
  assert.equal(restoreSavedLayers({}).showSectorLabels, false);

  // Включённый или выключенный переключатель «Подписи секторов» восстанавливается из черновика
  assert.equal(
    restoreSavedLayers({ showSectorLabels: true }).showSectorLabels,
    true
  );
  assert.equal(
    restoreSavedLayers({ showSectorLabels: false }).showSectorLabels,
    false
  );

  // Проверяем разметку index.html: переключатель #toggleSectorLabels присутствует и по умолчанию не отмечен
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const html = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
  const inputMatch = html.match(/<input[^>]*id="toggleSectorLabels"[^>]*>/);
  assert.ok(inputMatch, 'В index.html есть переключатель #toggleSectorLabels');
  assert.equal(
    /\bchecked\b/i.test(inputMatch[0]),
    false,
    'В index.html переключатель «Подписи секторов» по умолчанию выключен'
  );
  assert.match(html, /Подписи секторов/);
});

test('Задача 19 (п. 2): концы 8 осей (С, СВ, В, ЮВ, Ю, ЮЗ, З, СЗ) лежат на контуре или за ним строго по сторонам света', () => {
  const lShape = [
    { x: 190, y: 150 },
    { x: 830, y: 150 },
    { x: 830, y: 450 },
    { x: 1210, y: 450 },
    { x: 1210, y: 890 },
    { x: 190, y: 890 },
  ];

  // Пока Север не задан, оси не строятся
  const mapNoNorth = buildVastuMap(lShape, null);
  assert.equal(mapNoNorth.axes.length, 0);

  const expectedCodes = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
  const expectedAzimuths = [0, 45, 90, 135, 180, 225, 270, 315];

  function minDistToContourEdges(pt, poly) {
    let minD = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const d = pointToSegmentDistance(pt, a, b);
      if (d < minD) minD = d;
    }
    return minD;
  }

  for (const northDeg of [0, 22, 47, 135, 278.5, 338]) {
    const map = buildVastuMap(lShape, northDeg);
    assert.equal(map.axes.length, 8);
    assert.deepEqual(
      map.axes.map((a) => a.code),
      expectedCodes
    );
    assert.deepEqual(
      map.axes.map((a) => a.azimuthDeg),
      expectedAzimuths
    );

    for (const axis of map.axes) {
      // Начало каждой оси — строго в Брахмабинду (центре квартиры)
      approxEqual(axis.origin.x, map.center.x, 1e-9);
      approxEqual(axis.origin.y, map.center.y, 1e-9);

      // Главные оси С–Ю и В–З — cardinal, диагональные СВ–ЮЗ и ЮВ–СЗ — не cardinal
      const shouldBeCardinal = ['С', 'В', 'Ю', 'З'].includes(axis.code);
      assert.equal(axis.isCardinal, shouldBeCardinal);

      // Направление оси идёт строго по сторонам света от центра (northDeg + azimuthDeg), а не по стенам!
      const expectedPlanDeg = normalizeDeg(northDeg + axis.azimuthDeg);
      approxEqual(axis.planDeg, expectedPlanDeg, 1e-9);

      const contourAz = vectorToAzimuthDeg(
        axis.contourPoint.x - map.center.x,
        axis.contourPoint.y - map.center.y
      );
      const endAz = vectorToAzimuthDeg(
        axis.endPoint.x - map.center.x,
        axis.endPoint.y - map.center.y
      );
      approxEqual(signedAngleDeltaDeg(expectedPlanDeg, contourAz), 0, 1e-6);
      approxEqual(signedAngleDeltaDeg(expectedPlanDeg, endAz), 0, 1e-6);

      // В итоговой карте «Север сверху» (поворот на -northDeg) ось смотрит ровно на свой азимут (С = 0° вверх)
      approxEqual(
        normalizeDeg(endAz - northDeg),
        axis.azimuthDeg,
        1e-6,
        `Ось ${axis.code} в карте Севером вверх смотрит под углом ${axis.azimuthDeg}°`
      );

      // Точка contourPoint лежит прямо на контуре квартиры, а внешний конец endPoint — чуть за контуром
      approxEqual(
        minDistToContourEdges(axis.contourPoint, lShape),
        0,
        1e-5,
        `Точка пересечения оси ${axis.code} лежит на контуре квартиры`
      );
      assert.ok(axis.endDist > axis.contourDist, `Конец оси ${axis.code} выходит чуть за контур`);
      assert.equal(
        isPointInPolygon(axis.endPoint, lShape),
        false,
        `Внешний конец оси ${axis.code} лежит за пределами контура квартиры`
      );
    }
  }

  // П-образная квартира (центр вне стен): все 8 осей также строятся по нужным направлениям за контур
  const uShape = [
    { x: 0, y: 0 },
    { x: 120, y: 0 },
    { x: 120, y: 100 },
    { x: 95, y: 100 },
    { x: 95, y: 22 },
    { x: 25, y: 22 },
    { x: 25, y: 100 },
    { x: 0, y: 100 },
  ];
  const uAxes = computeAxes(uShape, null, 18);
  assert.equal(uAxes.length, 8);
  for (const axis of uAxes) {
    assert.equal(isPointInPolygon(axis.endPoint, uShape), false);
    const endAz = vectorToAzimuthDeg(
      axis.endPoint.x - axis.origin.x,
      axis.endPoint.y - axis.origin.y
    );
    approxEqual(signedAngleDeltaDeg(normalizeDeg(18 + axis.azimuthDeg), endAz), 0, 1e-6);
  }
});

test('Задача 20 (п. 1): порядок 4 шагов — без плана шаги 2–4 недоступны с подписью «сначала шаг 1», завершённые шаги отмечаются галочкой', () => {
  // 1) Пока плана нет (planCanvas === null), активен строго «1. План», а шаги 2–4 недоступны
  const noPlan = computeStepsState({
    planCanvas: null,
    activeTab: 'layers',
    northSet: false,
    vertices: [],
  });
  assert.equal(noPlan.hasPlan, false);
  assert.equal(noPlan.activeTab, 'plan', 'Без плана нельзя уйти со вкладки 1. План');
  assert.equal(noPlan.isPointPicking, false);
  assert.equal(noPlan.steps.length, 4);
  assert.deepEqual(
    noPlan.steps.map((s) => s.baseTitle),
    ['1. План', '2. Север', '3. Контур стен', '4. Карта']
  );

  assert.equal(noPlan.steps[0].disabled, false);
  assert.equal(noPlan.steps[0].active, true);
  assert.equal(noPlan.steps[0].completed, false);
  assert.equal(noPlan.steps[0].displayTitle, '1. План');

  for (const idx of [1, 2, 3]) {
    assert.equal(
      noPlan.steps[idx].disabled,
      true,
      `Шаг ${idx + 1} (${noPlan.steps[idx].baseTitle}) должен быть недоступен без плана`
    );
    assert.equal(noPlan.steps[idx].lockedCaption, STEP_LOCKED_CAPTION);
    assert.equal(noPlan.steps[idx].lockedCaption, 'сначала шаг 1');
  }

  // 2) Проверяем начальную разметку index.html: 4 пронумерованные вкладки, шаги 2–4 заблокированы (disabled) и содержат «сначала шаг 1»
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const html = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
  assert.match(html, /1\.\s*План/);
  assert.match(html, /2\.\s*Север/);
  assert.match(html, /3\.\s*Контур стен/);
  assert.match(html, /4\.\s*Карта/);
  assert.match(html, /Откройте план квартиры/);

  for (const btnId of ['tabBtnNorth', 'tabBtnContour', 'tabBtnLayers']) {
    const tagMatch = html.match(new RegExp(`<button[^>]*id="${btnId}"[^>]*>`));
    assert.ok(tagMatch, `В разметке присутствует кнопка вкладки #${btnId}`);
    assert.equal(
      /\bdisabled\b/i.test(tagMatch[0]),
      true,
      `В начальной разметке #${btnId} заблокирована (disabled) до загрузки плана`
    );
  }
  assert.match(html, /сначала шаг 1/);

  // 3) После загрузки плана шаги 2–4 открываются, а выполненные шаги получают галочку «✓»
  const quad = [
    { x: 0, y: 0 },
    { x: 300, y: 0 },
    { x: 300, y: 200 },
    { x: 0, y: 200 },
  ];
  const readyMap = buildVastuMap(quad, 338);
  const allReady = computeStepsState({
    planCanvas: {},
    activeTab: 'layers',
    northSet: true,
    northSource: 'satellite',
    northAngleDeg: 338,
    vertices: quad,
    vastuMap: readyMap,
    mapExported: true,
  });

  assert.equal(allReady.steps.every((s) => !s.disabled), true);
  assert.equal(allReady.steps.every((s) => s.lockedCaption === ''), true);
  assert.deepEqual(
    allReady.steps.map((s) => s.displayTitle),
    ['✓ 1. План', '✓ 2. Север', '✓ 3. Контур стен', '✓ 4. Карта']
  );

  // 4) Режим крупного окна постановки точек (isPointPicking) включается при отметке точек на спутнике, на плане и на контуре
  assert.equal(
    computeStepsState({
      planCanvas: {},
      activeTab: 'north',
      satViewMode: 'plan-pick',
    }).isPointPicking,
    true
  );
  assert.equal(
    computeStepsState({
      planCanvas: {},
      activeTab: 'contour',
      satViewMode: 'done',
    }).isPointPicking,
    true
  );
  assert.equal(
    computeStepsState({
      planCanvas: {},
      activeTab: 'north',
      satViewMode: 'done',
      northSet: true,
      northSource: 'satellite',
      northAngleDeg: 22,
    }).isPointPicking,
    false
  );
});

test('Задача 20 (п. 3а): блок «Запасной способ» и ручной ввод/поворот Севера полностью удалены из разметки и кода', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const html = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(repoRoot, 'src', 'app.js'), 'utf8');
  const helpersJs = fs.readFileSync(path.join(repoRoot, 'src', 'state-helpers.js'), 'utf8');
  const rendererJs = fs.readFileSync(path.join(repoRoot, 'src', 'renderer.js'), 'utf8');

  // В HTML нет заголовка «Запасной способ», бегунка, поля градусов и кнопок 0/90/180/270°
  assert.equal(/Запасной способ/i.test(html), false, 'В разметке нет блока «Запасной способ»');
  assert.equal(/id="northSlider"/.test(html), false, 'Нет бегунка градусов Севера');
  assert.equal(/id="northNumberInput"/.test(html), false, 'Нет поля ввода градусов Севера');
  assert.equal(/data-north=/.test(html), false, 'Нет быстрых кнопок градусов Севера');
  assert.equal(/Сверху 0°|Справа 90°|Снизу 180°|Слева 270°/.test(html), false);
  assert.equal(
    /поверните стрелку «С»|подправить пальцем на чертеже|градусами ниже/i.test(html),
    false,
    'В подсказках нет предложения крутить стрелку «С» вручную или вводить градусы'
  );

  // Проверка «С» после расчёта по спутнику остаётся в разметке
  assert.match(html, /Проверьте направление «С» на плане/);

  // В JS-коде удалены обработчики запасного способа и ручного вращения стрелки «С»
  for (const [name, src] of [
    ['src/app.js', appJs],
    ['src/state-helpers.js', helpersJs],
    ['src/renderer.js', rendererJs],
  ]) {
    assert.equal(/northSlider|northNumberInput|data-north/.test(src), false, `${name}: нет элементов запасного способа`);
    assert.equal(/rotate-north|hitTestNorthHandle|validateNorthDegreeInput/.test(src), false, `${name}: нет ручного поворота/ввода Севера`);
  }
});

test('Задача 20 (п. 3б): старый черновик с «ручным» Севером открывается без ошибок, сохраняет контур и просит задать Север по спутнику', () => {
  const savedCorners = [
    { x: 120, y: 100 },
    { x: 640, y: 100 },
    { x: 640, y: 380 },
    { x: 880, y: 380 },
    { x: 880, y: 720 },
    { x: 120, y: 720 },
  ];

  // 1) Старый черновик до Задачи 20 (version: 2, без поля northSource, Север = 90° задан вручную)
  const legacyManualDraft = {
    version: 2,
    savedAt: 1700000000000,
    isSamplePlan: false,
    planTitle: 'План БТИ 2-комн.jpg',
    sheetQuarterTurns: 1,
    basePlanWidth: 1200,
    basePlanHeight: 900,
    basePlanDataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
    vertices: savedCorners,
    northSet: true,
    northAngleDeg: 90,
    alignNorthUp: true,
    orthoSnap: false,
    activeTab: 'layers',
    layers: { showSectorLabels: true, showPadas: true },
  };

  const restoredLegacy = normalizeRestoredDraft(legacyManualDraft);
  assert.equal(restoredLegacy.hasDraft, true, 'Старый черновик успешно распознан без ошибок');
  assert.equal(restoredLegacy.planTitle, 'План БТИ 2-комн.jpg');
  assert.equal(restoredLegacy.sheetQuarterTurns, 1);
  assert.deepEqual(restoredLegacy.vertices, savedCorners, 'Контур стен ученицы полностью сохранён');
  assert.equal(restoredLegacy.layers.showSectorLabels, true);
  assert.equal(restoredLegacy.layers.showPadas, true);
  assert.equal(restoredLegacy.northSet, false, 'Ручной Север сброшен — требуется расчёт по спутнику');
  assert.equal(restoredLegacy.northSource, null);
  assert.equal(restoredLegacy.northAngleDeg, null);
  assert.equal(
    restoredLegacy.needsSatelliteNorthPrompt,
    true,
    'Включено уведомление с просьбой задать Север по спутнику'
  );
  assert.equal(
    restoredLegacy.activeTab,
    'north',
    'Ученица сразу переведена на шаг «2. Север» для привязки по спутнику'
  );

  // 2) Старый черновик с явным northSource: 'manual' также сбрасывает Север и просит спутник
  const explicitManualDraft = normalizeRestoredDraft({
    ...legacyManualDraft,
    northSource: 'manual',
    northAngleDeg: 270,
  });
  assert.equal(explicitManualDraft.northSet, false);
  assert.equal(explicitManualDraft.needsSatelliteNorthPrompt, true);
  assert.equal(explicitManualDraft.activeTab, 'north');

  // 3) Новый черновик, где Север был рассчитан по спутнику (northSource: 'satellite'), сохраняет Север
  const satelliteDraft = normalizeRestoredDraft({
    ...legacyManualDraft,
    northSet: true,
    northSource: 'satellite',
    northAngleDeg: 338,
    satPlanPts: [
      { x: 120, y: 100 },
      { x: 640, y: 100 },
    ],
    satHouseTiltDeg: 22,
    activeTab: 'layers',
  });
  assert.equal(satelliteDraft.hasDraft, true);
  assert.equal(satelliteDraft.northSet, true);
  assert.equal(satelliteDraft.northSource, 'satellite');
  approxEqual(satelliteDraft.northAngleDeg, 338, 1e-9);
  assert.equal(satelliteDraft.needsSatelliteNorthPrompt, false);
  assert.equal(satelliteDraft.activeTab, 'layers');
  assert.equal(satelliteDraft.satPlanPts.length, 2);
  approxEqual(satelliteDraft.satHouseTiltDeg, 22, 1e-9);
});

test('Задача 21 (кнопка «Новая карта»): видимость на шагах 2–4, полный сброс состояния и очистка хранилищ', async () => {
  const quad = [
    { x: 100, y: 100 },
    { x: 500, y: 100 },
    { x: 500, y: 400 },
    { x: 100, y: 400 },
  ];
  const readyMap = buildVastuMap(quad, 22);

  // 1) Видимость кнопки «Новая карта»: скрыта на шаге 1 (с планом и без), видна на шагах 2, 3 и 4
  assert.equal(
    computeStepsState({ planCanvas: null, activeTab: 'plan' }).showNewMapButton,
    false,
    'На пустом шаге 1 кнопка «Новая карта» скрыта'
  );
  assert.equal(
    computeStepsState({ planCanvas: {}, activeTab: 'plan' }).showNewMapButton,
    false,
    'На шаге 1 даже с загруженным планом кнопка «Новая карта» скрыта'
  );
  for (const tab of ['north', 'contour', 'layers']) {
    assert.equal(
      computeStepsState({ planCanvas: {}, activeTab: tab }).showNewMapButton,
      true,
      `На шаге ${tab} (после первого) кнопка «Новая карта» видна`
    );
  }

  // 2) Заполняем «грязное» рабочее состояние (план, точки, контур, север, спутник, подписи, масштаб, история)
  const history = createUndoHistory(40);
  history.pushContour(quad.slice(0, 3));
  const dirtyState = {
    isSamplePlan: true,
    sampleModified: true,
    basePlanCanvas: { width: 1400, height: 1060 },
    sheetQuarterTurns: 2,
    planCanvas: { width: 1400, height: 1060 },
    planWidth: 1400,
    planHeight: 1060,
    planTitle: 'Моя квартира.png',
    vertices: [...quad],
    undoHistory: history,
    selectedVertexIndex: 2,
    hoveredVertexIndex: 1,
    hoveredEdgeMidpoint: 0,
    orthoSnap: false,
    contourTransientHint: 'Подсказка',
    northSet: true,
    northSource: 'satellite',
    northAngleDeg: 22,
    legacyManualNorthNotice: true,
    alignNorthUp: false,
    frozenRotationDeg: -22,
    activeTab: 'layers',
    mapExported: true,
    layers: {
      showSectors: false,
      showSectorLabels: true,
      showAxes: false,
      showBrahmastan: false,
      showPadas: true,
      showPadaBelts: true,
      showPadaScores: true,
      sectorOpacity: 0.8,
    },
    sat: {
      canvas: { width: 780, height: 1688 },
      width: 780,
      height: 1688,
      title: 'sat.png',
      satPts: [
        { x: 10, y: 20 },
        { x: 200, y: 20 },
      ],
      planPts: [
        { x: 100, y: 100 },
        { x: 500, y: 100 },
      ],
      houseTiltDeg: 22,
    },
    satViewMode: 'done',
    satShortWallWarning: 'Короткая стена',
    satZoom: 2.8,
    satPanX: 45,
    satPanY: -30,
    vastuMap: readyMap,
    zoom: 2.35,
    panX: 120,
    panY: -85,
    lastRenderMeta: { placedAxesCount: 8 },
  };

  resetWorkspaceState(dirtyState);

  assert.equal(dirtyState.isSamplePlan, false);
  assert.equal(dirtyState.sampleModified, false);
  assert.equal(dirtyState.basePlanCanvas, null);
  assert.equal(dirtyState.sheetQuarterTurns, 0);
  assert.equal(dirtyState.planCanvas, null);
  assert.equal(dirtyState.planWidth, 0);
  assert.equal(dirtyState.planHeight, 0);
  assert.equal(dirtyState.planTitle, '');
  assert.deepEqual(dirtyState.vertices, []);
  assert.equal(dirtyState.undoHistory.length, 0);
  assert.equal(dirtyState.selectedVertexIndex, -1);
  assert.equal(dirtyState.hoveredVertexIndex, -1);
  assert.equal(dirtyState.hoveredEdgeMidpoint, null);
  assert.equal(dirtyState.orthoSnap, true);
  assert.equal(dirtyState.contourTransientHint, '');
  assert.equal(dirtyState.northSet, false);
  assert.equal(dirtyState.northSource, null);
  assert.equal(dirtyState.northAngleDeg, null);
  assert.equal(dirtyState.legacyManualNorthNotice, false);
  assert.equal(dirtyState.alignNorthUp, true);
  assert.equal(dirtyState.frozenRotationDeg, null);
  assert.equal(dirtyState.activeTab, 'plan');
  assert.equal(dirtyState.mapExported, false);
  assert.deepEqual(dirtyState.layers, createDefaultLayers());
  assert.equal(dirtyState.layers.showSectorLabels, false);
  assert.equal(dirtyState.sat.canvas, null);
  assert.equal(dirtyState.sat.width, 0);
  assert.equal(dirtyState.sat.height, 0);
  assert.equal(dirtyState.sat.title, '');
  assert.deepEqual(dirtyState.sat.satPts, []);
  assert.deepEqual(dirtyState.sat.planPts, []);
  assert.equal(dirtyState.sat.houseTiltDeg, null);
  assert.equal(dirtyState.satViewMode, 'idle');
  assert.equal(dirtyState.satShortWallWarning, '');
  assert.equal(dirtyState.satZoom, 1);
  assert.equal(dirtyState.satPanX, 0);
  assert.equal(dirtyState.satPanY, 0);
  assert.equal(dirtyState.vastuMap, null);
  assert.equal(dirtyState.zoom, 1);
  assert.equal(dirtyState.panX, 0);
  assert.equal(dirtyState.panY, 0);
  assert.equal(dirtyState.lastRenderMeta, null);

  const afterSteps = computeStepsState(dirtyState);
  assert.equal(afterSteps.activeTab, 'plan');
  assert.equal(afterSteps.hasPlan, false);
  assert.equal(afterSteps.showNewMapButton, false);
  assert.deepEqual(
    afterSteps.steps.map((s) => s.disabled),
    [false, true, true, true]
  );

  // 3) Очистка localStorage и sessionStorage в clearWorkspaceSession()
  const makeMockStorage = () => {
    const map = new Map();
    return {
      get length() {
        return map.size;
      },
      key(i) {
        return Array.from(map.keys())[i] ?? null;
      },
      getItem(k) {
        return map.has(k) ? map.get(k) : null;
      },
      setItem(k, v) {
        map.set(k, String(v));
      },
      removeItem(k) {
        map.delete(k);
      },
    };
  };
  const prevLS = globalThis.localStorage;
  const prevSS = globalThis.sessionStorage;
  try {
    const mockLS = makeMockStorage();
    const mockSS = makeMockStorage();
    mockLS.setItem('anna_romeo_vastu_karta_session_v2', '{"version":2}');
    mockLS.setItem('unrelated_key', 'keep');
    mockSS.setItem('anna_romeo_vastu_karta_session_v2', '{"version":2}');
    globalThis.localStorage = mockLS;
    globalThis.sessionStorage = mockSS;

    await clearWorkspaceSession();

    assert.equal(mockLS.getItem('anna_romeo_vastu_karta_session_v2'), null);
    assert.equal(mockSS.getItem('anna_romeo_vastu_karta_session_v2'), null);
    assert.equal(mockLS.getItem('unrelated_key'), 'keep');
  } finally {
    if (prevLS === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = prevLS;
    if (prevSS === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = prevSS;
  }

  // 4) Проверка разметки и отсутствия window.confirm
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const html = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(repoRoot, 'src', 'app.js'), 'utf8');
  assert.match(html, /<button[^>]*id="newMapBtn"[^>]*hidden[^>]*>\s*Новая карта\s*<\/button>/);
  assert.equal(/window\.confirm\s*\(/.test(appJs), false, 'Не используется системный window.confirm');
  assert.match(appJs, /Начать новую карту\?/);
  assert.match(appJs, /Текущая карта не сохранится\. Если она нужна, сначала сохраните её картинкой\./);
  assert.match(appJs, /Начать заново/);
});

test('Задача 22 (чистый экспорт карты): имя файла, отсутствие шапки/легенды/подвала/окошка Севера и обрезка по рисунку', () => {
  // 1) Имя файла: обычный экспорт не изменился, чистый получает приставку -bez-podpisej перед расширением
  const testDate = new Date(2026, 10, 23);
  assert.equal(buildExportFilename(testDate), 'karta-kvartiry-2026-11-23.png');
  assert.equal(buildExportFilename(testDate, { clean: false }), 'karta-kvartiry-2026-11-23.png');
  assert.equal(
    buildExportFilename(testDate, { clean: true }),
    'karta-kvartiry-2026-11-23-bez-podpisej.png'
  );

  // 2) Проверка рендера exportMapToPngCanvas в обоих режимах на мок-холсте Canvas 2D
  const lVertices = [
    { x: 190, y: 150 },
    { x: 830, y: 150 },
    { x: 830, y: 450 },
    { x: 1210, y: 450 },
    { x: 1210, y: 890 },
    { x: 190, y: 890 },
  ];
  const map = buildVastuMap(lVertices, 22);
  const baseState = {
    planCanvas: { width: 1400, height: 1060 },
    planWidth: 1400,
    planHeight: 1060,
    vertices: lVertices,
    vastuMap: map,
    northSet: true,
    northSource: 'satellite',
    northAngleDeg: 22,
    alignNorthUp: true,
    layers: {
      ...createDefaultLayers(),
      showSectors: true,
      showSectorLabels: false,
      showAxes: true,
      showBrahmastan: true,
      showPadas: false,
    },
  };

  const prevDocument = globalThis.document;
  const prevPath2D = globalThis.Path2D;

  function createMockDom() {
    const createdCanvases = [];
    const allTexts = [];
    const allDrawImages = [];
    const allFillRects = [];

    class MockPath2D {
      moveTo() {}
      lineTo() {}
      closePath() {}
    }

    const mockDocument = {
      createElement(tag) {
        if (tag !== 'canvas') {
          throw new Error(`Unexpected tag: ${tag}`);
        }
        const canvas = {
          width: 0,
          height: 0,
          texts: [],
          fillRects: [],
          drawImages: [],
          getContext() {
            return {
              fillStyle: '#000000',
              strokeStyle: '#000000',
              lineWidth: 1,
              lineJoin: 'miter',
              lineCap: 'butt',
              font: '12px sans-serif',
              textAlign: 'left',
              textBaseline: 'alphabetic',
              globalAlpha: 1,
              globalCompositeOperation: 'source-over',
              save() {},
              restore() {},
              scale() {},
              translate() {},
              rotate() {},
              clip() {},
              beginPath() {},
              moveTo() {},
              lineTo() {},
              arc() {},
              closePath() {},
              fill() {},
              stroke() {},
              setLineDash() {},
              strokeRect() {},
              fillRect(x, y, w, h) {
                const entry = { x, y, w, h, fillStyle: this.fillStyle };
                canvas.fillRects.push(entry);
                allFillRects.push(entry);
              },
              drawImage(...args) {
                canvas.drawImages.push(args);
                allDrawImages.push(args);
              },
              measureText(text) {
                const m = /(\d+(?:\.\d+)?)px/.exec(this.font);
                const fontPx = m ? Number(m[1]) : 14;
                return { width: String(text).length * fontPx * 0.58 };
              },
              fillText(text, x, y) {
                const entry = { text: String(text), x, y, fillStyle: this.fillStyle };
                canvas.texts.push(entry);
                allTexts.push(entry);
              },
            };
          },
        };
        createdCanvases.push(canvas);
        return canvas;
      },
    };

    return { mockDocument, MockPath2D, createdCanvases, allTexts, allDrawImages, allFillRects };
  }

  try {
    // 2а) Обычный экспорт (по умолчанию): полный лист 2400x1858 с шапкой, легендой, подвалом и окошком «С ↑»
    const normalEnv = createMockDom();
    globalThis.document = normalEnv.mockDocument;
    globalThis.Path2D = normalEnv.MockPath2D;

    const normalCanvas = exportMapToPngCanvas(baseState);
    assert.ok(normalCanvas);
    assert.equal(normalCanvas.width, 2400);
    assert.equal(normalCanvas.height, 1858);

    const normalTextStrings = normalEnv.allTexts.map((t) => t.text);
    assert.ok(normalTextStrings.includes('ВАСТУ-КАРТА ПРОСТРАНСТВА'), 'Обычный экспорт рисует шапку');
    assert.ok(
      normalTextStrings.some((s) => s.includes('Север сверху')),
      'Обычный экспорт рисует подпись справа в шапке'
    );
    assert.ok(normalTextStrings.includes('С · Север'), 'Обычный экспорт рисует легенду секторов');
    assert.ok(
      normalTextStrings.includes('Свободный приход денег'),
      'Обычный экспорт рисует значения секторов'
    );
    assert.ok(
      normalTextStrings.includes('Брахмастан по форме квартиры · Метод школы С. А. Балуты'),
      'Обычный экспорт рисует подпись школы в подвале'
    );
    assert.ok(
      normalTextStrings.includes('Васту-карта · Анна Ромео'),
      'Обычный экспорт рисует подпись бренда в подвале'
    );
    assert.equal(
      normalTextStrings.filter((s) => s === 'С').length,
      2,
      'Обычный экспорт рисует «С» на оси и второе «С» в окошке компаса справа сверху'
    );

    // 2б) Чистый экспорт ({ clean: true }): без шапки, легенды, подвала и окошка «С ↑», обрезан по рисунку
    const cleanEnv = createMockDom();
    globalThis.document = cleanEnv.mockDocument;
    globalThis.Path2D = cleanEnv.MockPath2D;

    const cleanCanvas = exportMapToPngCanvas(baseState, { clean: true });
    assert.ok(cleanCanvas);
    assert.equal(cleanCanvas.__exportRenderMeta.clean, true);
    assert.ok(
      cleanCanvas.width < normalCanvas.width - 400,
      `Чистый экспорт обрезан по ширине (${cleanCanvas.width} < ${normalCanvas.width - 400})`
    );
    assert.ok(
      cleanCanvas.height < normalCanvas.height - 300,
      `Чистый экспорт обрезан по высоте (${cleanCanvas.height} < ${normalCanvas.height - 300})`
    );

    const { cropRect } = cleanCanvas.__exportRenderMeta;
    assert.ok(cropRect && cropRect.pad > 0);
    const padRatio = cropRect.pad / cleanCanvas.width;
    assert.ok(
      padRatio >= 0.04 && padRatio <= 0.06,
      `Поле вокруг рисунка ${(padRatio * 100).toFixed(2)}% в пределах 4–6% ширины`
    );

    const cleanTextStrings = cleanEnv.allTexts.map((t) => t.text);
    assert.equal(
      cleanTextStrings.includes('ВАСТУ-КАРТА ПРОСТРАНСТВА'),
      false,
      'Чистый экспорт НЕ рисует шапку'
    );
    assert.equal(
      cleanTextStrings.some((s) => s.includes('Север сверху') || s.includes('Как на листе плана')),
      false,
      'Чистый экспорт НЕ рисует строку справа в шапке'
    );
    assert.equal(
      cleanTextStrings.some((s) => s.includes('С · Север') || s.includes('Свободный приход денег')),
      false,
      'Чистый экспорт НЕ рисует нижний блок с 8 значениями секторов'
    );
    assert.equal(
      cleanTextStrings.some((s) => s.includes('Метод школы С. А. Балуты')),
      false,
      'Чистый экспорт НЕ рисует подпись школы в подвале'
    );
    assert.equal(
      cleanTextStrings.some((s) => s.includes('Васту-карта · Анна Ромео')),
      false,
      'Чистый экспорт НЕ рисует подпись бренда в подвале'
    );
    assert.equal(
      cleanTextStrings.filter((s) => s === 'С').length,
      1,
      'Чистый экспорт рисует «С» только на оси, без отдельного окошка «С ↑»'
    );
    for (const dirCode of ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ']) {
      assert.ok(cleanTextStrings.includes(dirCode), `Чистый экспорт сохраняет ось «${dirCode}»`);
    }
    assert.ok(
      cleanTextStrings.includes('Брахмастан · Центр'),
      'Чистый экспорт сохраняет подпись Брахмастана'
    );
    assert.equal(
      cleanCanvas.fillRects[0].fillStyle,
      '#FAF8F4',
      'Фон чистого экспорта — светлый цвет карты (#FAF8F4)'
    );
    assert.equal(
      cleanCanvas.fillRects.some((r) => r.fillStyle === '#422326'),
      false,
      'На чистом экспорте нет бордовой плашки шапки'
    );

    // 2в) Чистый экспорт со слоем 32 пад: все 32 номера и все 8 осей попадают в обрезанную картинку
    const padasEnv = createMockDom();
    globalThis.document = padasEnv.mockDocument;
    globalThis.Path2D = padasEnv.MockPath2D;

    const cleanPadasCanvas = exportMapToPngCanvas(
      { ...baseState, layers: { ...baseState.layers, showPadas: true } },
      { clean: true }
    );
    assert.equal(cleanPadasCanvas.__exportRenderMeta.placedPadasCount, 32);
    assert.equal(cleanPadasCanvas.__exportRenderMeta.placedAxesCount, 8);
    for (const b of cleanPadasCanvas.__exportRenderMeta.placedBadges) {
      assert.ok(
        b.x1 >= 0 && b.y1 >= 0 && b.x2 <= cleanPadasCanvas.width && b.y2 <= cleanPadasCanvas.height,
        `Все подписи пад и осей целиком внутри чистого экспорта: ${JSON.stringify(b)}`
      );
    }
  } finally {
    if (prevDocument === undefined) delete globalThis.document;
    else globalThis.document = prevDocument;
    if (prevPath2D === undefined) delete globalThis.Path2D;
    else globalThis.Path2D = prevPath2D;
  }

  // 3) Проверка разметки кнопок «Скачать без подписей» и «Поделиться»
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const html = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
  assert.match(html, /<button[^>]*id="exportPngBtn"[^>]*>\s*Скачать карту\s*<\/button>/);
  assert.match(html, /<button[^>]*id="exportCleanPngBtn"[^>]*>\s*Скачать без подписей\s*<\/button>/);
  assert.match(html, /<button[^>]*id="shareCleanMapBtn"[^>]*>/);
});
