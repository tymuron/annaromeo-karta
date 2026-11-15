/**
 * Справочные данные метода Анны Ромео (школа С. А. Балуты).
 * Источники: palitra.md, metod.md, kb/_resheniya-anny.md, kb/02-vastu-karta.md,
 * kb/baluta/03b-vhod-v-dom-polnyi-tekst.md.
 */

export const BRAHMASTAN_META = {
  id: 'BS',
  short: 'БС',
  name: 'Брахмастан',
  subtitle: 'Сердце дома',
  formula: 'Жизнь в балансе',
  fillColor: '#FCFBF7',
  strokeColor: '#76643A',
  labelColor: '#422326',
  paletteNote: 'Молочно-белый, воздух и свободное пространство в центре дома',
};

/**
 * 8 радиальных секторов по 45° (±22,5° от каждой оси сторон света).
 * Цвета и смысловые формулы строго по palitra.md и metod.md Анны Ромео.
 * Порядок по часовой стрелке от Севера (0°).
 */
export const SECTORS = [
  {
    id: 'N',
    code: 'С',
    name: 'Север',
    centerAzimuth: 0,
    planet: 'Меркурий',
    formula: 'Свободный приход денег',
    fillColor: '#DFECE6',
    strokeColor: '#5B7D70',
    labelColor: '#243B33',
    paletteNote: 'Платиновый, светло-зелёный оникс, серебристо-белый',
  },
  {
    id: 'NE',
    code: 'СВ',
    name: 'Северо-восток',
    centerAzimuth: 45,
    planet: 'Юпитер',
    formula: 'Поток изобилия',
    fillColor: '#EDF5F8',
    strokeColor: '#5C8294',
    labelColor: '#233A45',
    paletteNote: 'Очень светло-голубой, бледно-водный, жемчужный (самый светлый сектор)',
  },
  {
    id: 'E',
    code: 'В',
    name: 'Восток',
    centerAzimuth: 90,
    planet: 'Солнце',
    formula: 'Энергия жизни и ясности',
    fillColor: '#F2E5C6',
    strokeColor: '#9C7B38',
    labelColor: '#473614',
    paletteNote: 'Светлый соломенный, тёплый песочный, солнечный беж',
  },
  {
    id: 'SE',
    code: 'ЮВ',
    name: 'Юго-восток',
    centerAzimuth: 135,
    planet: 'Венера',
    formula: 'Деньги через удовольствие и действие',
    fillColor: '#ECCAC3',
    strokeColor: '#9E5E52',
    labelColor: '#4A241D',
    paletteNote: 'Пыльно-розовый, персиково-коралловый, пудровый',
  },
  {
    id: 'S',
    code: 'Ю',
    name: 'Юг',
    centerAzimuth: 180,
    planet: 'Марс',
    formula: 'Сила действия и результата',
    fillColor: '#D19266',
    strokeColor: '#8C4E27',
    labelColor: '#3D1E0B',
    paletteNote: 'Терракот, охра, горчичный, тёплый кирпич',
  },
  {
    id: 'SW',
    code: 'ЮЗ',
    name: 'Юго-запад',
    centerAzimuth: 225,
    planet: 'Раху',
    formula: 'Глубина, вес и последовательность',
    fillColor: '#8B6855',
    strokeColor: '#593D2E',
    labelColor: '#2B1B13',
    paletteNote: 'Землистый коричневый, шоколад, кофейный, венге (самый плотный сектор)',
  },
  {
    id: 'W',
    code: 'З',
    name: 'Запад',
    centerAzimuth: 270,
    planet: 'Сатурн',
    formula: 'Результат и уважение',
    fillColor: '#969BA1',
    strokeColor: '#525860',
    labelColor: '#22262B',
    paletteNote: 'Бетонный, пепельный, графит, натуральный камень',
  },
  {
    id: 'NW',
    code: 'СЗ',
    name: 'Северо-запад',
    centerAzimuth: 315,
    planet: 'Луна',
    formula: 'Воздух, честность и движение',
    fillColor: '#E2E4EF',
    strokeColor: '#696F8C',
    labelColor: '#2B2F42',
    paletteNote: 'Светло-сиреневый жемчужный, пыльно-голубой, серебристый',
  },
];

/**
 * Оценки 32 внешних пад по книге С. А. Балуты (т. 3, с. 94, рис. 110).
 * Нумерация 1..32 по часовой стрелке, пада 1 лежит ровно по центру Востока (90°),
 * пада 9 — Юг (180°), пада 17 — Запад (270°), пада 25 — Север (0°).
 * Каждая пада занимает 360° / 32 = 11,25°.
 */
const BALUTA_PADA_SCORES = [
  0, -1, -2, -3, -4, -3, -1, 1,
  -5, 0, -1, -2, -4, -1, 1, 2,
  0, 0, -1, -2, -3, 0, 3, 4,
  3, 0, -1, -3, -4, 0, 3, 5,
];

function sectorCodeForAzimuth(azimuthDeg) {
  const norm = ((azimuthDeg % 360) + 360) % 360;
  for (const sector of SECTORS) {
    const diff = Math.abs((((norm - sector.centerAzimuth + 540) % 360) - 180));
    if (diff <= 22.5 + 1e-9) {
      return sector.code;
    }
  }
  return 'С';
}

export const PADAS = BALUTA_PADA_SCORES.map((score, idx) => {
  const number = idx + 1;
  const centerAzimuth = (90 + idx * 11.25) % 360;
  const startAzimuth = (centerAzimuth - 5.625 + 360) % 360;
  const endAzimuth = (centerAzimuth + 5.625) % 360;
  return {
    number,
    centerAzimuth,
    startAzimuth,
    endAzimuth,
    spanDeg: 11.25,
    score,
    sectorCode: sectorCodeForAzimuth(centerAzimuth),
    isFavorable: score > 0,
  };
});

/**
 * Концентрические частотные пояса по форме квартиры (гомотетия от центра):
 * 1/9 линейного масштаба (1/81 площади) — Брахмабинду,
 * 3/9 (1/3 линейно, 1/9 площади) — Брахмастан,
 * 5/9 — пояс Дева,
 * 7/9 — граница пояса Манушья и внешнего пояса Пайшача (до стен 9/9).
 */
export const CONCENTRIC_BELTS = [
  { id: 'bindu', scale: 1 / 9, label: '1/9 · Брахмабинду' },
  { id: 'brahmastan', scale: 3 / 9, label: '3/9 · Брахмастан' },
  { id: 'deva', scale: 5 / 9, label: '5/9 · Пояс Дева' },
  { id: 'manusha', scale: 7 / 9, label: '7/9 · Пояс Манушья' },
];
