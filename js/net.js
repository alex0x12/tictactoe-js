import { X } from './board.js'
import { createGame, rebuild, resign } from './game.js'
import { loadAccount } from './storage.js'

// net.js это разговор с сервером. Тут обёртки над fetch для каждого адреса и перевод
// ответа сервера в обычный объект партии, с которым умеют работать game.js и ui.js.
// Модуль не трогает страницу, поэтому fromServer и replayFromServer гоняют тестами в Node.
// Токен берётся из хранилища через storage.js, сам модуль localStorage не трогает.

// request(method, path, body) шлёт запрос и возвращает разобранный JSON из ответа.
// Это единственное место, где вызывается fetch. Токен добавляется в заголовок сам, если
// игрок вошёл: сервер по нему узнаёт, кто спрашивает. Ошибки бывают двух видов, и страница
// показывает text как есть, поэтому тексты уже готовые для игрока:
//   сервер ответил ошибкой: Error с текстом из поля error и полем status с кодом ответа,
//     по коду страница узнаёт 401 и забывает токен;
//   сервер не ответил совсем: Error('Сервер недоступен'), поля status у него нет.
// headers это заголовки запроса, account это вошедший игрок или null, res это ответ,
// data это тело ответа или null, если это не JSON.
async function request(method, path, body) {
  const headers = {}
  const account = loadAccount()
  if (account) headers.Authorization = `Bearer ${account.token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  let res
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    // fetch бросает, только если ответа не было совсем: сервер выключен или нет сети
    throw new Error('Сервер недоступен')
  }

  // под python -m http.server на адреса API приходит HTML-страница с ошибкой,
  // JSON из неё не разобрать, тогда data равен null
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const error = new Error(data?.error ?? 'Сервер недоступен')
    error.status = res.status
    throw error
  }
  return data
}

// --- по функции на каждый адрес сервера ---

// register(nickname, password) и login(nickname, password) возвращают { token, nickname }.
function register(nickname, password) {
  return request('POST', '/register', { nickname, password })
}

function login(nickname, password) {
  return request('POST', '/login', { nickname, password })
}

// logout() просит сервер забыть токен. Тело не нужно, токен уходит в заголовке.
function logout() {
  return request('POST', '/logout')
}

// getLeaderboard() возвращает список игроков для рейтинга, getProfile() возвращает
// профиль вошедшего игрока: счётчики и список его партий.
function getLeaderboard() {
  return request('GET', '/leaderboard')
}

function getProfile() {
  return request('GET', '/profile')
}

// newGame(N, K, invite) начинает партию по сети: со случайным соперником или,
// если invite равен true, по приглашению. Возвращает партию в виде ответа сервера.
function newGame(N, K, invite) {
  return request('POST', '/games', { N, K, invite })
}

// joinGame(id) входит в партию по ссылке, getGame(id) просто читает партию.
// encodeURIComponent нужен потому, что id попадает в адрес, а пришёл он из ссылки,
// то есть от другого человека.
function joinGame(id) {
  return request('POST', `/games/${encodeURIComponent(id)}/join`)
}

function getGame(id) {
  return request('GET', `/games/${encodeURIComponent(id)}`)
}

// sendMove(id, cell) отправляет ход в клетку cell, sendResign(id) отправляет сдачу.
// Оба адреса одинаковые, сервер отличает их по телу. Ответ это партия целиком.
function sendMove(id, cell) {
  return request('POST', `/games/${encodeURIComponent(id)}/move`, { cell })
}

function sendResign(id) {
  return request('POST', `/games/${encodeURIComponent(id)}/move`, { resign: true })
}

// --- ответ сервера в объект партии ---

// onlineOf(view) собирает из ответа сервера блок state.online: то, что знает только
// сервер и чего нет в обычной партии. outcome здесь это итог на сервере. В повторе
// state.outcome меняется с каждым шагом, а итог нужен для строки "Итог: ...".
// view это ответ сервера о партии.
function onlineOf(view) {
  const { id, invite, x, o, you, outcome, winner, timeLeft } = view
  return { id, invite, x, o, you, outcome, winner, timeLeft }
}

// fromServer(view) превращает партию из ответа сервера в обычный объект партии,
// поэтому доска, победная линия и отрисовка работают на старом коде. Режим 'online',
// humanSide это сторона того, кто спросил (поле you).
// Историю копируем, а не берём из ответа: иначе ход на экране менял бы и сам ответ.
// rebuild сдачу по ходам не видит, поэтому при outcome === 'resign' она ставится отдельно.
// С проигрышем по времени то же самое: на доске его нет, и при outcome === 'timeout'
// он ставится отдельно. Остаток времени на ход лежит в online.timeLeft.
// game это собираемая партия.
function fromServer(view) {
  const game = createGame({
    N: view.N,
    K: view.K,
    mode: 'online',
    difficulty: 'medium',
    humanFirst: view.you === X,
    seed: 0,
  })
  game.history = [...view.history]
  rebuild(game)
  if (view.outcome === 'resign') resign(game)
  if (view.outcome === 'timeout') game.outcome = 'timeout'
  game.online = onlineOf(view)
  return game
}

// replayFromServer(view) собирает партию для повтора: пустая доска, а все ходы лежат
// в стеке redo. Повтор целиком держится на undo и redo из game.js. redo берёт ходы
// с конца стека, поэтому ходы кладутся в обратном порядке: первым вернётся первый ход
// партии. Режим 'pvp', потому что в нём undo снимает ровно один полуход, а в 'online'
// снимал бы пару. replay.playing говорит, идёт ли сейчас проигрывание: по нему кнопка
// называется "Пуск" или "Пауза".
function replayFromServer(view) {
  const game = createGame({
    N: view.N,
    K: view.K,
    mode: 'pvp',
    difficulty: 'medium',
    humanFirst: true,
    seed: 0,
  })
  game.redo = [...view.history].reverse()
  game.online = onlineOf(view)
  game.replay = { playing: false }
  return game
}

export {
  register, login, logout, getLeaderboard, getProfile,
  newGame, joinGame, getGame, sendMove, sendResign,
  fromServer, replayFromServer,
}
