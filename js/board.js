const EMPTY = 0
const X = 1
const O = 2

function idx(r, c, N) {
  return r * N + c;
}

function rowOf(i, N) {
  return (i / N) | 0;
}

function colOf(i, N) {
  return (i % N);
}

function inside(r, c, N) {
  return r >= 0 && r < N && c >= 0 && c < N;
}

function createBoard(N) {
  return new Int8Array(N * N).fill(EMPTY);
}

function place(cells, i, p) {
  cells[i] = p;
}

function unplace(cells, i) {
  cells[i] = EMPTY;
}

function opponent(p) {
  return 3 - p
}

export { EMPTY, X, O, idx, rowOf, colOf, inside, createBoard, place, unplace, opponent }
