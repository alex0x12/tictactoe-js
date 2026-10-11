import {rowOf, colOf, inside, idx, EMPTY} from './board.js'

// Четыре оси, по которым может встать цепочка: горизонталь, вертикаль и две диагонали.
// Пара [dr, dc] задаёт шаг по строке и столбцу. В обратную сторону идём тем же шагом
// с минусом, поэтому осей четыре, а не восемь.
const DIRECTIONS = [[0, 1], [1, 0], [1, 1], [1, -1]]

// hasWin(cells, N, K, last, player) проверяет, собрал ли player K камней подряд,
// поставив последний в клетку last. Возвращает true или false, зовётся после каждого хода.
// Смысл в том, что новая победа может появиться только на оси, которая проходит через last,
// поэтому всю доску смотреть не надо, хватает четырёх осей вокруг last.
// r и c это координаты last, dr и dc это шаг текущей оси, count это длина цепочки
// (начинается с единицы, потому что сам last в неё уже входит), rr и cc это бегущие
// координаты при проходе туда и обратно.
function hasWin(cells, N, K, last, player) {
  // координаты камня, который только что поставили
  const r = rowOf(last, N);
  const c = colOf(last, N);

  // перебираем четыре оси: горизонталь, вертикаль, две диагонали
  for (const [dr, dc] of DIRECTIONS) {
    // сам last уже часть цепочки, поэтому счёт начинаем с единицы
    let count = 1;
    let rr, cc;

    // идём вперёд, пока не упрёмся в край поля или в чужой камень
    for (rr = r + dr, cc = c + dc;
         inside(rr, cc, N) && cells[idx(rr, cc, N)] === player;
         rr += dr, cc += dc) {
      count++;
    }

    // идём назад: last мог стоять в середине цепочки, а не с краю
    for (rr = r - dr, cc = c - dc;
         inside(rr, cc, N) && cells[idx(rr, cc, N)] === player;
         rr -= dr, cc -= dc) {
      count++;
    }

    // цепочка может быть длиннее K, это тоже победа, поэтому >= а не ===
    if (count >= K) return true;
  }

  // ни по одной оси до K не дотянули
  return false;
}

// winLine(cells, N, K, last, player) возвращает индексы всех клеток выигрышной линии,
// которая проходит через last, или null, если победы нет. Нужна интерфейсу для подсветки
// и game.js для state.winLine. Ходит по тем же четырём осям, что hasWin, только не считает
// камни, а собирает их индексы, причём всю цепочку целиком, даже если она длиннее K.
// r и c это координаты last, dr и dc шаг оси, rr и cc бегущие координаты, а line это
// накопленный список индексов: last кладётся в середину, камни вперёд уходят в конец,
// камни назад подставляются в начало через unshift, чтобы индексы шли по порядку вдоль оси.
function winLine(cells, N, K, last, player) {
  const r = rowOf(last, N);
  const c = colOf(last, N);

  for (const [dr, dc] of DIRECTIONS) {
    // начинаем с last, дальше добавляем камни вперёд и назад
    const line = [last];
    let rr, cc;

    // вперёд добавляем в конец
    for (rr = r + dr, cc = c + dc;
         inside(rr, cc, N) && cells[idx(rr, cc, N)] === player;
         rr += dr, cc += dc) {
      line.push(idx(rr, cc, N));
    }

    // назад добавляем в начало, чтобы порядок в line был вдоль оси
    for (rr = r - dr, cc = c - dc;
         inside(rr, cc, N) && cells[idx(rr, cc, N)] === player;
         rr -= dr, cc -= dc) {
      line.unshift(idx(rr, cc, N));
    }

    if (line.length >= K) return line;
  }

  return null;
}

// CANDIDATE_THRESHOLD это сколько пустых клеток считаем "мало". Пока их не больше,
// ИИ перебирает все пустые, это точнее. Если больше, круг сужается до окрестности
// уже поставленных камней.
const CANDIDATE_THRESHOLD = 30

// candidates(cells, N, K) возвращает индексы пустых клеток, в которые стоит ходить.
// Её зовёт поиск ИИ: чем меньше вариантов, тем глубже он успевает зайти.
// Ветки по количеству пустых: если их мало (маленькие поля и концовки партий), берём все,
// если доска совсем пустая, берём центр, иначе берём пустые клетки в радиусе R вокруг камней.
// Внутри total это всего клеток, empties сколько из них пусто, out результат, mid центр
// пустой доски, R радиус окрестности (2 при K >= 5, иначе 1), а seen это метки "клетка уже
// добавлена" в виде Uint8Array вместо Set. Так дешевле и меньше мусора, ведь функция
// зовётся на каждом узле поиска.
function candidates(cells, N, K) {
  const total = N * N;

  // один проход: считаем пустые
  let empties = 0;
  for (let i = 0; i < total; i++) {
    if (cells[i] === EMPTY) empties++;
  }

  // пустых мало, берём все. Сюда попадают поля 3x3..5x5 целиком и концовки больших партий
  if (empties <= CANDIDATE_THRESHOLD) {
    const out = [];
    for (let i = 0; i < total; i++) {
      if (cells[i] === EMPTY) out.push(i);
    }
    return out;
  }

  // доска пуста, окрестность строить не вокруг чего, берём центр.
  // Эта проверка идёт после порога: на пустом 3x3 сработает порог и вернёт 9 клеток
  if (empties === total) {
    const mid = (N - 1) >> 1;
    return [idx(mid, mid, N)];
  }

  // обычный случай: пустые клетки в радиусе R вокруг занятых.
  // При K >= 5 нужен R = 2, иначе не видны ходы с пропуском вроде X-X-X
  const R = K >= 5 ? 2 : 1;

  const seen = new Uint8Array(total);

  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (cells[idx(r, c, N)] === EMPTY) continue;  // смотрим только занятые клетки

      // обходим квадрат со стороной 2R+1 вокруг этой клетки
      for (let dr = -R; dr <= R; dr++) {
        for (let dc = -R; dc <= R; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (!inside(rr, cc, N)) continue;         // границы проверяем до idx
          const i = idx(rr, cc, N);
          if (cells[i] === EMPTY) seen[i] = 1;      // 1 значит "клетка в списке"
        }
      }
    }
  }

  // собираем результат по возрастанию индексов, так ответ всегда одинаковый
  const out = [];
  for (let i = 0; i < total; i++) {
    if (seen[i]) out.push(i);
  }
  return out;
}

// isBoardFull(cells) проверяет, остались ли на доске пустые клетки. Зовётся из game.js
// после каждого хода рядом с winLine и ещё в rebuild при восстановлении партии.
// Возвращает false на первой же пустой клетке, так что до конца обычно не доходит.
function isBoardFull(cells)
{
  for (let i = 0; i < cells.length; i++)
    if (cells[i] === EMPTY)
      return false;
  return true;
}

export { DIRECTIONS, hasWin, winLine, candidates, isBoardFull };
