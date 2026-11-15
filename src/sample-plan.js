/**
 * Генератор собственного учебного архитектурного плана Г-образной квартиры
 * (рисуется программно на Canvas — без чужих картинок и внешних ресурсов).
 */

export function createSampleFloorPlan() {
  const width = 1400;
  const height = 1060;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Светлый чертёжный лист
  ctx.fillStyle = '#FAF8F4';
  ctx.fillRect(0, 0, width, height);

  // Тонкая миллиметровая сетка на фоне листа
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

  // Внутренний контур Г-образной квартиры (по внутренним поверхностям наружных стен):
  // Верхнее левое крыло + нижнее правое крыло (включая тёплую остеклённую лоджию-кабинет)
  const innerContour = [
    { x: 190, y: 150 },
    { x: 830, y: 150 },
    { x: 830, y: 450 },
    { x: 1210, y: 450 },
    { x: 1210, y: 890 },
    { x: 190, y: 890 },
  ];

  // Внешний контур несущих стен (толщина наружной стены 28 px)
  const wallT = 28;
  const outerContour = [
    { x: 190 - wallT, y: 150 - wallT },
    { x: 830 + wallT, y: 150 - wallT },
    { x: 830 + wallT, y: 450 - wallT },
    { x: 1210 + wallT, y: 450 - wallT },
    { x: 1210 + wallT, y: 890 + wallT },
    { x: 190 - wallT, y: 890 + wallT },
  ];

  // Заливка пола внутри квартиры
  ctx.save();
  ctx.beginPath();
  innerContour.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.restore();

  // Рисуем капитальные наружные стены (заливка между outer и inner)
  ctx.save();
  ctx.beginPath();
  outerContour.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  innerContour
    .slice()
    .reverse()
    .forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  ctx.fillStyle = '#3B3533';
  ctx.fill();
  ctx.restore();

  // Межкомнатные перегородки (толщина 12 px)
  ctx.fillStyle = '#524A47';
  const partitions = [
    // Вертикальная стена между спальней (слева вверху) и кухней-столовой
    { x: 520, y: 150, w: 12, h: 350 },
    // Горизонтальная стена под спальней и кухней (с проёмами)
    { x: 190, y: 500, w: 210, h: 12 },
    { x: 485, y: 500, w: 155, h: 12 },
    { x: 725, y: 500, w: 105, h: 12 },
    // Перегородки санузла и гардеробной внизу слева
    { x: 470, y: 660, w: 12, h: 230 },
    { x: 190, y: 660, w: 195, h: 12 },
    { x: 445, y: 660, w: 37, h: 12 },
    // Перегородка между гостиной и прихожей/кабинетом справа
    { x: 830, y: 500, w: 12, h: 115 },
    { x: 830, y: 715, w: 12, h: 175 },
    // Выделение тёплой лоджии-кабинета у правого фасада
    { x: 1065, y: 450, w: 10, h: 130 },
    { x: 1065, y: 700, w: 10, h: 190 },
  ];
  for (const part of partitions) {
    ctx.fillRect(part.x, part.y, part.w, part.h);
  }

  // Вентиляционный короб у санузла (штриховка)
  ctx.save();
  ctx.fillStyle = '#E8E3DC';
  ctx.strokeStyle = '#524A47';
  ctx.lineWidth = 2;
  ctx.fillRect(392, 672, 78, 46);
  ctx.strokeRect(392, 672, 78, 46);
  ctx.beginPath();
  ctx.moveTo(392, 672);
  ctx.lineTo(470, 718);
  ctx.moveTo(470, 672);
  ctx.lineTo(392, 718);
  ctx.stroke();
  ctx.restore();

  // Функция отрисовки окна в наружной стене
  function drawWindow(x, y, w, h, horizontal = true) {
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

  // Окна по фасадам
  drawWindow(265, 150 - wallT, 180, wallT, true); // Спальня (верх)
  drawWindow(595, 150 - wallT, 165, wallT, true); // Кухня (верх)
  drawWindow(905, 450 - wallT, 120, wallT, true); // Кабинет (верх правого крыла)
  drawWindow(1210, 515, wallT, 300, false); // Панорамное остекление тёплой лоджии (справа)
  drawWindow(570, 890, 200, wallT, true); // Гостиная (низ)

  // Межкомнатные двери с дугой открывания
  function drawDoor(hingeX, hingeY, radius, leafAngleRad, swingEndAngleRad) {
    ctx.save();
    ctx.strokeStyle = '#6E625D';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(hingeX, hingeY);
    ctx.lineTo(
      hingeX + Math.cos(leafAngleRad) * radius,
      hingeY + Math.sin(leafAngleRad) * radius
    );
    ctx.stroke();

    ctx.strokeStyle = 'rgba(110, 98, 93, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    const anticlockwise = swingEndAngleRad < leafAngleRad;
    ctx.arc(hingeX, hingeY, radius, leafAngleRad, swingEndAngleRad, anticlockwise);
    ctx.stroke();
    ctx.restore();
  }

  drawDoor(400, 506, 85, -Math.PI / 2, 0); // Дверь в спальню
  drawDoor(640, 506, 85, -Math.PI / 2, 0); // Дверь в кухню
  drawDoor(385, 666, 60, Math.PI / 2, 0); // Дверь в ванную
  drawDoor(836, 615, 100, 0, Math.PI / 2); // Проём в прихожую/холл

  // Входная дверь в квартиру (нижняя стена правого крыла)
  ctx.save();
  ctx.fillStyle = '#FAF8F4';
  ctx.fillRect(905, 890, 96, wallT);
  ctx.strokeStyle = '#422326';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(905, 890);
  ctx.lineTo(905, 804);
  ctx.stroke();
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.arc(905, 890, 86, -Math.PI / 2, 0, false);
  ctx.stroke();
  ctx.restore();

  // Схематичные контуры мебели (тонкая архитектурная графика)
  ctx.save();
  ctx.strokeStyle = 'rgba(82, 74, 71, 0.38)';
  ctx.fillStyle = 'rgba(82, 74, 71, 0.04)';
  ctx.lineWidth = 1.5;

  // Кровать в спальне
  ctx.fillRect(215, 235, 175, 145);
  ctx.strokeRect(215, 235, 175, 145);
  ctx.strokeRect(225, 248, 36, 52);
  ctx.strokeRect(225, 314, 36, 52);

  // Кухонный гарнитур и круглый стол
  ctx.fillRect(532, 165, 285, 48);
  ctx.strokeRect(532, 165, 285, 48);
  ctx.beginPath();
  ctx.arc(685, 345, 48, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Диван в гостиной
  ctx.fillRect(515, 725, 240, 82);
  ctx.strokeRect(515, 725, 240, 82);
  ctx.strokeRect(515, 785, 240, 22);

  // Ванна и раковина
  ctx.fillRect(205, 795, 150, 72);
  ctx.strokeRect(205, 795, 150, 72);

  // Рабочий стол на тёплой лоджии
  ctx.fillRect(1110, 530, 78, 150);
  ctx.strokeRect(1110, 530, 78, 150);
  ctx.restore();

  // Подписи помещений и размерные отметки
  ctx.save();
  ctx.fillStyle = '#574C48';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const roomLabels = [
    { text: 'СПАЛЬНЯ', area: '16,4 м²', x: 365, y: 425 },
    { text: 'КУХНЯ-СТОЛОВАЯ', area: '14,8 м²', x: 685, y: 435 },
    { text: 'ГОСТИНАЯ', area: '24,2 м²', x: 655, y: 615 },
    { text: 'ВАННАЯ', area: '6,8 м²', x: 325, y: 745 },
    { text: 'ПРИХОЖАЯ', area: '9,5 м²', x: 950, y: 665 },
    { text: 'ЛОДЖИЯ', area: '6,2 м²', x: 1142, y: 775 },
  ];

  for (const r of roomLabels) {
    ctx.font = '600 17px Manrope, sans-serif';
    ctx.fillStyle = '#4A3F3B';
    ctx.fillText(r.text, r.x, r.y - 11);
    ctx.font = '400 14px Manrope, sans-serif';
    ctx.fillStyle = '#7C706B';
    ctx.fillText(r.area, r.x, r.y + 12);
  }

  // Подпись «ВХОД» у входной двери
  ctx.font = '600 14px Manrope, sans-serif';
  ctx.fillStyle = '#422326';
  ctx.fillText('ВХОД', 953, 942);

  // Габаритные выносные линии сверху и слева
  ctx.strokeStyle = 'rgba(87, 76, 72, 0.45)';
  ctx.fillStyle = '#6E625D';
  ctx.lineWidth = 1;
  ctx.font = '500 14px Manrope, sans-serif';

  // Верхний размер 6,40 м
  ctx.beginPath();
  ctx.moveTo(190, 92);
  ctx.lineTo(830, 92);
  ctx.moveTo(190, 82);
  ctx.lineTo(190, 108);
  ctx.moveTo(830, 82);
  ctx.lineTo(830, 108);
  ctx.stroke();
  ctx.fillText('6,40 м', 510, 76);

  // Правое крыло 3,80 м
  ctx.beginPath();
  ctx.moveTo(830, 392);
  ctx.lineTo(1210, 392);
  ctx.moveTo(830, 382);
  ctx.lineTo(830, 408);
  ctx.moveTo(1210, 382);
  ctx.lineTo(1210, 408);
  ctx.stroke();
  ctx.fillText('3,80 м', 1020, 376);

  // Левый размер 7,40 м
  ctx.beginPath();
  ctx.moveTo(118, 150);
  ctx.lineTo(118, 890);
  ctx.moveTo(108, 150);
  ctx.lineTo(134, 150);
  ctx.moveTo(108, 890);
  ctx.lineTo(134, 890);
  ctx.stroke();
  ctx.save();
  ctx.translate(98, 520);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('7,40 м', 0, 0);
  ctx.restore();

  // Штамп учебного плана в правом верхнем свободном поле
  ctx.textAlign = 'right';
  ctx.font = '500 14px Manrope, sans-serif';
  ctx.fillStyle = 'rgba(66, 35, 38, 0.55)';
  ctx.fillText('УЧЕБНЫЙ ПЛАН · Г-ОБРАЗНАЯ КВАРТИРА (77,9 м²)', 1235, 136);
  ctx.font = '400 13px Manrope, sans-serif';
  ctx.fillStyle = 'rgba(66, 35, 38, 0.42)';
  ctx.fillText('Лоджия остеклена и используется как рабочий кабинет', 1235, 158);
  ctx.restore();

  return {
    canvas,
    width,
    height,
    defaultVertices: innerContour.map((p) => ({ ...p })),
    defaultNorthDeg: 22,
    title: 'Учебный план (Г-образная квартира)',
  };
}
