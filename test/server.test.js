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
