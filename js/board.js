// Значения клетки: 0 пусто, 1 крестик, 2 нолик.
// Из этого соглашения выходит opponent = 3 - player, так что нигде не нужно ветвление.
const EMPTY = 0
const X = 1
const O = 2

// idx(r, c, N) переводит строку и столбец в плоский индекс r * N + c.
// Доска лежит одним Int8Array, а не массивом массивов: поиск ИИ обходит её
// миллионы раз, и так это заметно дешевле.
function idx(r, c, N) {
  return r * N + c;
}

// rowOf(i, N) и colOf(i, N) делают обратное: из индекса получают строку и столбец.
// Нужны и правилам для проверки линии, и интерфейсу для подписей вида "C3".
function rowOf(i, N) {
  // "| 0" отбрасывает дробную часть, это короче чем Math.floor
  return (i / N) | 0;
}

function colOf(i, N) {
  return (i % N);
}

// inside(r, c, N) проверяет, что координаты не вышли за поле.
// Зовётся до idx, иначе idx посчитал бы индекс за границей массива.
function inside(r, c, N) {
  return r >= 0 && r < N && c >= 0 && c < N;
}

// createBoard(N) делает пустую доску: Int8Array из N * N нулей.
// Вызывается в начале партии и ещё раз в rebuild.
function createBoard(N) {
  return new Int8Array(N * N).fill(EMPTY);
}

// place(cells, i, p) ставит камень стороны p в клетку i, unplace(cells, i) убирает его.
// Это пара: place нужен applyMove, когда игрок ходит, unplace нужен undo при откате.
function place(cells, i, p) {
  cells[i] = p;
}

function unplace(cells, i) {
  cells[i] = EMPTY;
}

// opponent(p) возвращает соперника. Считается как 3 - p, потому что крестик и нолик
// вместе дают 3.
function opponent(p) {
  return 3 - p
}

export { EMPTY, X, O, idx, rowOf, colOf, inside, createBoard, place, unplace, opponent }
