import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDeg,
  azimuthToUnitVector,
  vectorToAzimuthDeg,
  signedAngleDeltaDeg,
  northAngleFromWallSegments,
  polygonArea,
  computePolygonCenter,
  isPointInPolygon,
  hasSelfIntersection,
  computeBrahmastan,
  computeSectors,
  getSectorForPoint,
  getPadaForPoint,
  computePadaGrid,
  buildVastuMap,
  CENTER_OUTSIDE_NOTE,
} from '../src/geometry.js';
import {
  applySheetRotation90CW,
  createUndoHistory,
  buildExportFilename,
  validateNorthDegreeInput,
  canExportVastuMap,
} from '../src/state-helpers.js';

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

test('Расчёт Севера по двум отрезкам стены (спутник и план): порядок точек 1 и 2 и поворот на 180°', () => {
  // 1) На спутнике стена 1 -> 2 идёт строго с Запада на Восток (азимут 90°).
  //    На плане та же стена 1 -> 2 тоже идёт слева направо (90°) -> Север на плане сверху (0°).
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

  // 2) Если перепутать порядок точек 1 и 2 ТОЛЬКО на плане (отметить 2 -> 1),
  //    направление меняется ровно на 180° (Север окажется снизу, 180°)!
  approxEqual(
    northAngleFromWallSegments(satW2E_1, satW2E_2, planL2R_2, planL2R_1),
    180,
    1e-9,
    'Смена порядка точек 1 и 2 на плане разворачивает Север ровно на 180°'
  );

  // 3) Если поменять местами 1 и 2 и на спутнике, и на плане одновременно — угол Севера сохраняется!
  approxEqual(
    northAngleFromWallSegments(satW2E_2, satW2E_1, planL2R_2, planL2R_1),
    0,
    1e-9,
    'Одинаковый обратный обход той же стены на обоих изображениях даёт тот же Север'
  );

  // 4) Дом на спутнике повёрнут на +22° по часовой стрелке: стена 1 -> 2 идёт под азимутом 112°.
  //    На листе плана эта же стена 1 -> 2 начерчена горизонтально вправо (90°).
  //    Тогда Север на листе плана лежит под углом 90° - 112° = 338° (при повороте «Север сверху» план довернётся на +22°!).
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

  // Смена порядка 1 и 2 на снимке при произвольном угле также даёт точный сдвиг на 180°
  const computedFlipped = northAngleFromWallSegments(
    satTilted2,
    satTilted1,
    planL2R_1,
    planL2R_2
  );
  approxEqual(computedFlipped, normalizeDeg(computedNorth + 180), 1e-6, 'Поворот на 180° при смене 1 и 2');

  // 5) Нулевой отрезок (совпадающие точки) возвращает null
  assert.equal(
    northAngleFromWallSegments(satW2E_1, satW2E_1, planL2R_1, planL2R_2),
    null
  );
  assert.equal(
    northAngleFromWallSegments(satW2E_1, satW2E_2, planL2R_1, planL2R_1),
    null
  );

  // Проверка знаковой дельты угла при вращении стрелки через 0°/360°
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

  // Пока Север не задан (null), buildVastuMap не строит ни сектора, ни сетку пад
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

test('Брахмастан по форме квартиры: 1/9 площади, частичное отсечение (area > 0), центр вне стен и нулевая площадь', () => {
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
  approxEqual(map1.brahmastan.area, polygonArea(regularL) / 9, 1e-5);
  assert.equal(map1.brahmastan.wasClipped, false);

  // 2) Несимметричная Г-образная квартира (рис. 16 у С. А. Балуты):
  //    центр внутри стен, но часть Брахмастана выходит наружу и отсекается, причём оставшаяся площадь > 0!
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
  assert.ok(bs2.area > 0, 'Оставшаяся внутри стен площадь Брахмастана строго больше нуля');
  assert.ok(bs2.area < bs2.rawArea, 'Отсечённая площадь меньше расчётной 1/9');
  assert.equal(bs2.isEmpty, false);
  assert.equal(map2.centerOutsideOrClipped, false);
  for (const piece of bs2.pieces) {
    for (const pt of piece) {
      assert.equal(isPointInPolygon(pt, partialClipL), true);
    }
  }

  // 3) Узкий Г-образный уголок (thinCornerL): центр вне стен, а отсечённый Брахмастан имеет нулевую площадь!
  const thinCornerL = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 18 },
    { x: 18, y: 18 },
    { x: 18, y: 100 },
    { x: 0, y: 100 },
  ];
  const mapThin = buildVastuMap(thinCornerL, 15);
  assert.equal(mapThin.centerInside, false, 'Центр тонкого уголка оказался вне стен');
  approxEqual(mapThin.brahmastan.area, 0, 1e-6, 'Площадь Брахмастана внутри стен равна 0');
  assert.equal(mapThin.brahmastan.isEmpty, true);
  assert.equal(mapThin.brahmastan.isMostlyClipped, true);
  assert.equal(mapThin.centerOutsideOrClipped, true);
  assert.equal(mapThin.centerNote, CENTER_OUTSIDE_NOTE);

  // 4) П-образная квартира: центр попадает во внутренний двор (вне стен) -> спокойная пометка для Анны
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
  assert.equal(mapU.centerInside, false, 'Центр П-образной квартиры оказался во дворе вне стен');
  assert.equal(mapU.centerOutsideOrClipped, true);
  assert.equal(mapU.centerNote, 'Центр вне стен — покажите эту карту Анне');
});

test('История «Отменить» при повороте листа на 90° возвращает лист, контур и Север вместе', () => {
  const history = createUndoHistory();
  const initialState = {
    sheetQuarterTurns: 0,
    planWidth: 1000,
    planHeight: 600,
    vertices: [
      { x: 100, y: 150 },
      { x: 500, y: 150 },
      { x: 500, y: 450 },
    ],
    satPlanPts: [
      { x: 100, y: 150 },
      { x: 500, y: 150 },
    ],
    northSet: true,
    northAngleDeg: 35,
  };

  history.push(initialState);
  const rotated = applySheetRotation90CW(initialState);

  assert.equal(rotated.sheetQuarterTurns, 1);
  assert.equal(rotated.planWidth, 600);
  assert.equal(rotated.planHeight, 1000);
  approxEqual(rotated.northAngleDeg, 125, 1e-9, 'Север повернулся вместе с листом на +90°');
  assert.deepEqual(rotated.vertices[0], { x: 450, y: 100 });

  // «Отменить» восстанавливает и ориентацию листа, и размеры, и контур, и Север одновременно
  const restored = history.pop();
  assert.ok(restored);
  assert.equal(restored.sheetQuarterTurns, 0);
  assert.equal(restored.planWidth, 1000);
  assert.equal(restored.planHeight, 600);
  assert.equal(restored.northSet, true);
  approxEqual(restored.northAngleDeg, 35, 1e-9);
  assert.deepEqual(restored.vertices, initialState.vertices);
  assert.deepEqual(restored.satPlanPts, initialState.satPlanPts);

  // Если Север ещё не задан, поворот листа не придумывает градусы Севера
  const unsetRotated = applySheetRotation90CW({
    ...initialState,
    northSet: false,
    northAngleDeg: null,
  });
  assert.equal(unsetRotated.northSet, false);
  assert.equal(unsetRotated.northAngleDeg, null);
});

test('Имя файла сохранения, валидация поля градусов 0–360 и запрет сохранения без контура или Севера', () => {
  assert.equal(
    buildExportFilename(new Date(2026, 10, 15)),
    'karta-kvartiry-2026-11-15.png'
  );
  assert.equal(
    buildExportFilename(new Date(2026, 2, 5)),
    'karta-kvartiry-2026-03-05.png'
  );

  // Поле градусов принимает только числа в диапазоне [0, 360]
  assert.equal(validateNorthDegreeInput('0').ok, true);
  assert.equal(validateNorthDegreeInput('360').ok, true);
  assert.equal(validateNorthDegreeInput('22,5').value, 22.5);
  assert.equal(validateNorthDegreeInput('-5').ok, false);
  assert.equal(validateNorthDegreeInput('360.5').ok, false);
  assert.equal(validateNorthDegreeInput('420').ok, false);
  assert.equal(validateNorthDegreeInput('12e2').ok, false);

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
    false,
    'Нельзя сохранять без заданного Севера'
  );
  assert.equal(
    canExportVastuMap({
      planCanvas: {},
      northSet: true,
      northAngleDeg: 40,
      vertices: validVertices.slice(0, 2),
      vastuMap: null,
    }),
    false,
    'Нельзя сохранять без замкнутого контура'
  );
  assert.equal(
    canExportVastuMap({
      planCanvas: {},
      northSet: true,
      northAngleDeg: 40,
      vertices: validVertices,
      vastuMap: map,
    }),
    true,
    'Сохранение доступно при заданном Севере и замкнутом контуре'
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
