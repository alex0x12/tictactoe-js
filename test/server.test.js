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
