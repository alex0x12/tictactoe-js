import {rowOf, colOf, inside, idx, EMPTY} from './board.js'

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

const CANDIDATE_THRESHOLD = 30

// Возвращает индексы пустых клеток, в которые осмысленно ходить.
// На малых полях и в эндшпиле - все пустые; на пустой доске - центр;
// иначе — пустые в радиусе R вокруг каждого камня.
function candidates(cells, N, K) {
  const total = N * N;

  // Один проход: сколько пустых и пуста ли доска целиком
  let empties = 0;
  for (let i = 0; i < total; i++) {
    if (cells[i] === EMPTY) empties++;
  }

  // Ветка 1: пустых мало — полный перебор.
  // Сюда попадают все поля 3×3..5×5 целиком и концовки больших партий.
  if (empties <= CANDIDATE_THRESHOLD) {
    const out = [];
    for (let i = 0; i < total; i++) {
      if (cells[i] === EMPTY) out.push(i);
    }
    return out;
  }

  // Ветка 2: доска пуста — строить окрестность не вокруг чего, берём центр.
  // Проверка идёт ПОСЛЕ порога: на пустом 3×3 сработает порог и вернёт 9 клеток.
  if (empties === total) {
    const mid = (N - 1) >> 1;
    return [idx(mid, mid, N)];
  }

  // Ветка 3: обычный случай — окрестность радиуса R вокруг занятых клеток.
  // При K>=5 нужен R=2: ходы с пропуском (X-X-X) иначе не видны.
  const R = K >= 5 ? 2 : 1;

  // Uint8Array вместо Set: дешевле аллоцируется и не даёт мусора,
  // а функция вызывается на каждом узле поиска.
  const seen = new Uint8Array(total);

  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (cells[idx(r, c, N)] === EMPTY) continue;  // рассматриваем только занятые клетки

      // Обходим квадрат (2R+1)×(2R+1) с центром в этой клетке
      for (let dr = -R; dr <= R; dr++) {
        for (let dc = -R; dc <= R; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (!inside(rr, cc, N)) continue;         // границы проверяем до индекса
          const i = idx(rr, cc, N);
          if (cells[i] === EMPTY) seen[i] = 1;      // 1 = «клетка в списке»
        }
      }
    }
  }

  // Собираем результат в порядке индексов — так ответ детерминирован
  const out = [];
  for (let i = 0; i < total; i++) {
    if (seen[i]) out.push(i);
  }
  return out;
}

function isBoardFull(cells)
{
  for (let i = 0; i < cells.length; i++)
    if (cells[i] === EMPTY)
      return false;
  return true;
}

export { DIRECTIONS, hasWin, winLine, candidates, isBoardFull };
