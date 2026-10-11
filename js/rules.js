import {rowOf, colOf, inside, idx} from './board.js'

const DIRECTIONS = [[0, 1], [1, 0], [1, 1], [1, -1]]

// Проверяет, собрал ли player цепочку из K камней, поставив камень в last-индекс.
// Смотрит только вдоль четырёх осей, проходящих через last:
// победа после одного хода может появиться только на линии с этим ходом.
function hasWin(cells, N, K, last, player) {
  // Координаты только что поставленного камня
  const r = rowOf(last, N);
  const c = colOf(last, N);

  // Перебираем четыре оси: горизонталь, вертикаль, две диагонали
  for (const [dr, dc] of DIRECTIONS) {
    // Сам last уже часть цепочки, поэтому начинаем с единицы
    let count = 1;
    let rr, cc;

    // Вперёд вдоль оси: накапливаем камни player, пока не упрёмся в край или в чужой камень
    for (rr = r + dr, cc = c + dc;
         inside(rr, cc, N) && cells[idx(rr, cc, N)] === player;
         rr += dr, cc += dc) {
      count++;
    }

    // Назад вдоль той же оси: last мог стоять в середине цепочки, а не на конце
    for (rr = r - dr, cc = c - dc;
         inside(rr, cc, N) && cells[idx(rr, cc, N)] === player;
         rr -= dr, cc -= dc) {
      count++;
    }

    // Цепочка длиннее K — тоже победа, поэтому >=, а не ===
    if (count >= K) return true;
  }

  // Ни одна из четырёх осей не дотянула до K
  return false;
}

// Возвращает массив индексов всех клеток выигрышной линии через last,
// или null, если победы нет. Цепочка может быть длиннее K — возвращаем всю.
function winLine(cells, N, K, last, player) {
  const r = rowOf(last, N);
  const c = colOf(last, N);

  for (const [dr, dc] of DIRECTIONS) {
    // line строится с last в середине: сначала накапливаем «вперёд»,
    // потом «назад» вставляем перед ним через unshift
    const line = [last];
    let rr, cc;

    // Вперёд: добавляем в конец
    for (rr = r + dr, cc = c + dc;
         inside(rr, cc, N) && cells[idx(rr, cc, N)] === player;
         rr += dr, cc += dc) {
      line.push(idx(rr, cc, N));
    }

    // Назад: добавляем в начало, чтобы порядок в line был вдоль оси
    for (rr = r - dr, cc = c - dc;
         inside(rr, cc, N) && cells[idx(rr, cc, N)] === player;
         rr -= dr, cc -= dc) {
      line.unshift(idx(rr, cc, N));
    }

    if (line.length >= K) return line;
  }

  return null;
}

export { DIRECTIONS, hasWin, winLine };
