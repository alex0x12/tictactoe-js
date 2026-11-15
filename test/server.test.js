import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { openDb } from '../server/db.js'
import { createApp } from '../server/app.js'

// Каждый тест поднимает сервер на свободном порту с чистой базой в памяти
// и шлёт ему настоящие HTTP-запросы через fetch.
let server
let base

beforeEach(async () => {
  server = createApp(openDb(':memory:')).listen(0)
  await once(server, 'listening')
  base = `http://127.0.0.1:${server.address().port}`
})

// fetch держит соединение открытым для следующих запросов, поэтому закрываем
// соединения сами, иначе server.close ждал бы их несколько секунд
afterEach(async () => {
  server.closeAllConnections()
  server.close()
  await once(server, 'close')
})

// call(method, path, body, token) шлёт запрос и возвращает { status, body }.
// body ответа разбирается как JSON, если сервер прислал JSON, иначе остаётся текстом.
async function call(method, path, body, token) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const isJson = (res.headers.get('content-type') ?? '').includes('application/json')
  return { status: res.status, body: isJson ? await res.json() : await res.text() }
}

// signUp(nickname) регистрирует игрока с паролем secret1 и возвращает его токен.
async function signUp(nickname) {
  const res = await call('POST', '/register', { nickname, password: 'secret1' })
  assert.equal(res.status, 201)
  return res.body.token
}

// startPair() регистрирует alex и masha и сажает их в одну партию 3x3:
// alex ждёт случайного соперника крестиком, masha приходит ноликом.
async function startPair() {
  const alex = await signUp('alex')
  const masha = await signUp('masha')
  const first = await call('POST', '/games', { N: 3, K: 3 }, alex)
  await call('POST', '/games', { N: 3, K: 3 }, masha)
  return { alex, masha, id: first.body.id }
}

// move(token, id, cell) делает ход в клетку cell и возвращает ответ сервера.
function move(token, id, cell) {
  return call('POST', `/games/${id}/move`, { cell }, token)
}

// --- задача 1: страница, закрытые файлы, плохой JSON ---

test('страница, модули и стили отдаются', async () => {
  const page = await call('GET', '/')
  assert.equal(page.status, 200)
  assert.match(page.body, /<!DOCTYPE html>/i)
  assert.equal((await call('GET', '/js/game.js')).status, 200)
  assert.equal((await call('GET', '/css/style.css')).status, 200)
})

test('код сервера, база, тесты и package.json не отдаются', async () => {
  for (const path of ['/server/app.js', '/server/ttt.db', '/test/server.test.js', '/package.json']) {
    assert.equal((await call('GET', path)).status, 404, path)
  }
})

test('тело не в формате JSON даёт 400', async () => {
  const res = await fetch(base + '/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{oops',
  })
  assert.equal(res.status, 400)
  assert.deepEqual(await res.json(), { error: 'Неверный формат запроса' })
})

// --- задача 2: регистрация, вход, выход ---

test('регистрация выдаёт токен', async () => {
  const res = await call('POST', '/register', { nickname: 'alex', password: 'secret1' })
  assert.equal(res.status, 201)
  assert.equal(res.body.nickname, 'alex')
  assert.match(res.body.token, /^[0-9a-f]{32}$/)
})

test('никнейм уникален без учёта регистра', async () => {
  await signUp('alex')
  const res = await call('POST', '/register', { nickname: 'Alex', password: 'secret1' })
  assert.equal(res.status, 409)
  assert.deepEqual(res.body, { error: 'Этот никнейм уже занят' })
})

test('плохой никнейм и короткий пароль дают 400', async () => {
  // 12345 и undefined проверяют тип: регулярка сама превратила бы их в строки "12345"
  // и "undefined", и обе подошли бы
  for (const nickname of ['ab', 'алекс', 'a b', 'x'.repeat(21), 12345, undefined]) {
    const res = await call('POST', '/register', { nickname, password: 'secret1' })
    assert.equal(res.status, 400, String(nickname))
    assert.deepEqual(res.body, { error: 'Никнейм: от 3 до 20 латинских букв, цифр или _' })
  }
  for (const password of ['12345', 1234567, undefined]) {
    const res = await call('POST', '/register', { nickname: 'alex', password })
    assert.equal(res.status, 400, String(password))
    assert.deepEqual(res.body, { error: 'Пароль должен быть не короче 6 символов' })
  }
})

test('вход: верный пароль даёт новый токен, неверный и чужой ник одинаково 401', async () => {
  const first = await signUp('alex')
  const ok = await call('POST', '/login', { nickname: 'ALEX', password: 'secret1' })
  assert.equal(ok.status, 200)
  assert.equal(ok.body.nickname, 'alex')
  assert.match(ok.body.token, /^[0-9a-f]{32}$/)
  assert.notEqual(ok.body.token, first)

  const bad = await call('POST', '/login', { nickname: 'alex', password: 'wrong11' })
  assert.equal(bad.status, 401)
  assert.deepEqual(bad.body, { error: 'Неверный никнейм или пароль' })

  for (const body of [{ nickname: 'nobody', password: 'secret1' }, { nickname: 'alex' }, {}]) {
    const res = await call('POST', '/login', body)
    assert.equal(res.status, 401, JSON.stringify(body))
    assert.deepEqual(res.body, bad.body)
  }
})

test('выход отключает токен, новый вход снова работает', async () => {
  const token = await signUp('alex')
  const out = await call('POST', '/logout', undefined, token)
  assert.equal(out.status, 200)
  assert.deepEqual(out.body, {})

  const again = await call('POST', '/logout', undefined, token)
  assert.equal(again.status, 401)
  assert.deepEqual(again.body, { error: 'Нужно войти' })

  const login = await call('POST', '/login', { nickname: 'alex', password: 'secret1' })
  assert.equal((await call('POST', '/logout', undefined, login.body.token)).status, 200)
})

test('без токена и с выдуманным токеном 401', async () => {
  for (const token of [undefined, 'f'.repeat(32)]) {
    const res = await call('POST', '/logout', undefined, token)
    assert.equal(res.status, 401)
    assert.deepEqual(res.body, { error: 'Нужно войти' })
  }
})

// --- задача 3: новая партия, случайный соперник, приглашение, просмотр ---

test('новая партия требует вход и проверяет N и K', async () => {
  assert.equal((await call('POST', '/games', { N: 3, K: 3 })).status, 401)

  const alex = await signUp('alex')
  const bad = [{ N: 2, K: 2 }, { N: 16, K: 5 }, { N: 5, K: 6 }, { N: 5, K: 2 },
    { N: '5', K: 3 }, { N: 3.5, K: 3 }, {}]
  for (const body of bad) {
    const res = await call('POST', '/games', body, alex)
    assert.equal(res.status, 400, JSON.stringify(body))
    assert.deepEqual(res.body, { error: 'N от 3 до 15, K от 3 до N' })
  }
})

test('случайный соперник: второй игрок попадает в партию первого', async () => {
  const alex = await signUp('alex')
  const masha = await signUp('masha')

  const a = await call('POST', '/games', { N: 3, K: 3 }, alex)
  assert.equal(a.status, 201)
  assert.match(a.body.id, /^[0-9a-f]{12}$/)
  assert.deepEqual(a.body, {
    id: a.body.id, N: 3, K: 3, invite: false, x: 'alex', o: null, you: 1,
    history: [], outcome: null, winner: null,
  })

  const m = await call('POST', '/games', { N: 3, K: 3 }, masha)
  assert.equal(m.status, 201)
  assert.equal(m.body.id, a.body.id)
  assert.equal(m.body.x, 'alex')
  assert.equal(m.body.o, 'masha')
  assert.equal(m.body.you, 2)
})

test('случайный соперник ищется только с теми же N и K', async () => {
  const alex = await signUp('alex')
  const petya = await signUp('petya')
  const a = await call('POST', '/games', { N: 3, K: 3 }, alex)
  const p = await call('POST', '/games', { N: 5, K: 4 }, petya)
  assert.notEqual(p.body.id, a.body.id)
  assert.equal(p.body.x, 'petya')
  assert.equal(p.body.o, null)
})

test('новая партия удаляет старую ждущую партию того же игрока', async () => {
  const alex = await signUp('alex')
  const old = await call('POST', '/games', { N: 3, K: 3 }, alex)
  await call('POST', '/games', { N: 5, K: 4, invite: true }, alex)
  const res = await call('GET', `/games/${old.body.id}`, undefined, alex)
  assert.equal(res.status, 404)
  assert.deepEqual(res.body, { error: 'Партия не найдена' })
})

test('приглашение: случайный игрок в него не попадает, друг входит по id', async () => {
  const alex = await signUp('alex')
  const masha = await signUp('masha')
  const petya = await signUp('petya')

  const inv = await call('POST', '/games', { N: 3, K: 3, invite: true }, alex)
  assert.equal(inv.status, 201)
  assert.equal(inv.body.invite, true)

  const random = await call('POST', '/games', { N: 3, K: 3 }, petya)
  assert.notEqual(random.body.id, inv.body.id)

  const join = await call('POST', `/games/${inv.body.id}/join`, undefined, masha)
  assert.equal(join.status, 200)
  assert.equal(join.body.o, 'masha')
  assert.equal(join.body.you, 2)
})

test('вход по ссылке: свои получают партию, третий 409, неизвестная 404', async () => {
  const alex = await signUp('alex')
  const masha = await signUp('masha')
  const petya = await signUp('petya')
  const { body: { id } } = await call('POST', '/games', { N: 3, K: 3, invite: true }, alex)

  // создатель открыл свою ссылку: партия отдаётся, место нолика остаётся свободным
  const own = await call('POST', `/games/${id}/join`, undefined, alex)
  assert.equal(own.status, 200)
  assert.equal(own.body.o, null)

  await call('POST', `/games/${id}/join`, undefined, masha)
  const again = await call('POST', `/games/${id}/join`, undefined, masha)
  assert.equal(again.status, 200)
  assert.equal(again.body.o, 'masha')

  const third = await call('POST', `/games/${id}/join`, undefined, petya)
  assert.equal(third.status, 409)
  assert.deepEqual(third.body, { error: 'В партии уже два игрока' })

  const none = await call('POST', '/games/000000000000/join', undefined, petya)
  assert.equal(none.status, 404)
  assert.deepEqual(none.body, { error: 'Партия не найдена' })
})

test('партию видят только её игроки', async () => {
  const { alex, masha, id } = await startPair()
  const petya = await signUp('petya')
  assert.equal((await call('GET', `/games/${id}`, undefined, alex)).body.you, 1)
  assert.equal((await call('GET', `/games/${id}`, undefined, masha)).body.you, 2)

  const res = await call('GET', `/games/${id}`, undefined, petya)
  assert.equal(res.status, 403)
  assert.deepEqual(res.body, { error: 'Это не ваша партия' })
})

// --- задача 4: ходы, сдача, конец партии, рейтинг ---

test('ходы по очереди, оба игрока видят одну историю', async () => {
  const { alex, masha, id } = await startPair()
  const r1 = await move(alex, id, 4)
  assert.equal(r1.status, 200)
  assert.deepEqual(r1.body.history, [4])

  const r2 = await move(masha, id, 0)
  assert.deepEqual(r2.body.history, [4, 0])

  const seen = await call('GET', `/games/${id}`, undefined, alex)
  assert.deepEqual(seen.body.history, [4, 0])
})

test('ход не в свою очередь 409, в занятую или несуществующую клетку 400', async () => {
  const { alex, masha, id } = await startPair()
  const early = await move(masha, id, 0)
  assert.equal(early.status, 409)
  assert.deepEqual(early.body, { error: 'Не ваш ход' })

  await move(alex, id, 4)
  for (const cell of [4, 9, -1, 1.5, '0', undefined]) {
    const res = await move(masha, id, cell)
    assert.equal(res.status, 400, String(cell))
    assert.deepEqual(res.body, { error: 'Так ходить нельзя' })
  }
})

test('ход и сдача до прихода соперника 409, посторонний 403', async () => {
  const alex = await signUp('alex')
  const petya = await signUp('petya')
  const { body: { id } } = await call('POST', '/games', { N: 3, K: 3, invite: true }, alex)

  const early = await move(alex, id, 4)
  assert.equal(early.status, 409)
  assert.deepEqual(early.body, { error: 'Соперник ещё не пришёл' })

  const resign = await call('POST', `/games/${id}/move`, { resign: true }, alex)
  assert.equal(resign.status, 409)

  const stranger = await move(petya, id, 4)
  assert.equal(stranger.status, 403)
  assert.deepEqual(stranger.body, { error: 'Это не ваша партия' })
})

test('победа: итог, победитель, запрет ходов и рейтинг', async () => {
  const { alex, masha, id } = await startPair()
  // крестик собирает верхнюю строку 0 1 2, нолик ходит в 3 и 4
  for (const [token, cell] of [[alex, 0], [masha, 3], [alex, 1], [masha, 4]]) {
    assert.equal((await move(token, id, cell)).status, 200)
  }
  const last = await move(alex, id, 2)
  assert.equal(last.body.outcome, 'win')
  assert.equal(last.body.winner, 'alex')

  const after = await move(masha, id, 5)
  assert.equal(after.status, 409)
  assert.deepEqual(after.body, { error: 'Партия уже закончена' })

  const board = await call('GET', '/leaderboard')
  assert.equal(board.status, 200)
  assert.deepEqual(board.body, [
    { nickname: 'alex', wins: 1, draws: 0, losses: 0, points: 3 },
    { nickname: 'masha', wins: 0, draws: 0, losses: 1, points: 0 },
  ])
})

test('ничья даёт обоим по ничьей и по очку', async () => {
  const { alex, masha, id } = await startPair()
  // доска заполняется без линии: ✕ ○ ✕ / ✕ ○ ○ / ○ ✕ ✕
  const cells = [0, 1, 2, 4, 3, 5, 7, 6, 8]
  let res
  for (let i = 0; i < cells.length; i++) {
    res = await move(i % 2 === 0 ? alex : masha, id, cells[i])
    assert.equal(res.status, 200)
  }
  assert.equal(res.body.outcome, 'draw')
  assert.equal(res.body.winner, null)

  const board = await call('GET', '/leaderboard')
  assert.deepEqual(board.body, [
    { nickname: 'alex', wins: 0, draws: 1, losses: 0, points: 1 },
    { nickname: 'masha', wins: 0, draws: 1, losses: 0, points: 1 },
  ])
})

test('сдача отдаёт победу сопернику, сдаться можно не в свою очередь', async () => {
  const { alex, masha, id } = await startPair()
  await move(alex, id, 4)
  await move(masha, id, 0)

  // сейчас очередь alex, а сдаётся masha
  const res = await call('POST', `/games/${id}/move`, { resign: true }, masha)
  assert.equal(res.status, 200)
  assert.equal(res.body.outcome, 'resign')
  assert.equal(res.body.winner, 'alex')
  assert.deepEqual(res.body.history, [4, 0])

  const board = await call('GET', '/leaderboard')
  assert.deepEqual(board.body.map((r) => [r.nickname, r.wins, r.losses]), [
    ['alex', 1, 0],
    ['masha', 0, 1],
  ])
})

test('в рейтинг не попадают те, кто ещё не играл', async () => {
  await signUp('alex')
  const board = await call('GET', '/leaderboard')
  assert.equal(board.status, 200)
  assert.deepEqual(board.body, [])
})

// --- задача 5: профиль ---

test('профиль: счётчики, очки и партии со своей стороны', async () => {
  const { alex, masha, id } = await startPair()
  for (const [token, cell] of [[alex, 0], [masha, 3], [alex, 1], [masha, 4], [alex, 2]]) {
    await move(token, id, cell)
  }
  // вторая партия: masha ждёт, alex приходит, партия идёт
  const second = await call('POST', '/games', { N: 5, K: 4 }, masha)
  await call('POST', '/games', { N: 5, K: 4 }, alex)
  // третья: alex ждёт друга, такая партия в профиль не попадает
  await call('POST', '/games', { N: 7, K: 5, invite: true }, alex)
  // чужая партия: в профиль alex не попадает
  const petya = await signUp('petya')
  const olga = await signUp('olga')
  await call('POST', '/games', { N: 3, K: 3 }, petya)
  await call('POST', '/games', { N: 3, K: 3 }, olga)

  const res = await call('GET', '/profile', undefined, alex)
  assert.equal(res.status, 200)
  const { games, ...stats } = res.body
  assert.deepEqual(stats, { nickname: 'alex', wins: 1, draws: 0, losses: 0, points: 3 })
  assert.deepEqual(games.map((g) => [g.id, g.N, g.K, g.opponent, g.result, g.moves]), [
    [second.body.id, 5, 4, 'masha', 'playing', 0],
    [id, 3, 3, 'masha', 'win', 5],
  ])
  assert.equal(typeof games[0].created, 'number')
  assert.ok(games[0].created >= games[1].created)

  const her = await call('GET', '/profile', undefined, masha)
  assert.deepEqual(her.body.games.map((g) => [g.opponent, g.result]), [
    ['alex', 'playing'],
    ['alex', 'loss'],
  ])
})

test('профиль без токена 401, после выхода тоже', async () => {
  assert.equal((await call('GET', '/profile')).status, 401)

  const token = await signUp('alex')
  const fresh = await call('GET', '/profile', undefined, token)
  assert.deepEqual(fresh.body, { nickname: 'alex', wins: 0, draws: 0, losses: 0, points: 0, games: [] })

  await call('POST', '/logout', undefined, token)
  assert.equal((await call('GET', '/profile', undefined, token)).status, 401)
})

// --- задача 11: страницы рейтинга и профиля ---

test('страницы рейтинга и профиля отдаются', async () => {
  for (const path of ['/rating.html', '/profile.html']) {
    const page = await call('GET', path)
    assert.equal(page.status, 200, path)
    assert.match(page.body, /<!DOCTYPE html>/i)
  }
})

// --- кэш браузера ---

test('ответы API помечены no-store, а страница и скрипты нет', async () => {
  const token = await signUp('alex')
  const api = [
    ['/leaderboard', {}],
    ['/profile', { Authorization: `Bearer ${token}` }],
    ['/games/000000000000', { Authorization: `Bearer ${token}` }],
  ]
  for (const [path, headers] of api) {
    const res = await fetch(base + path, { headers })
    assert.equal(res.headers.get('cache-control'), 'no-store', path)
  }
  for (const path of ['/', '/js/game.js']) {
    const res = await fetch(base + path)
    assert.notEqual(res.headers.get('cache-control'), 'no-store', path)
  }
})
