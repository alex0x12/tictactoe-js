import { getProfile, logout, register, login } from './net.js'
import { loadAccount, saveAccount, clearAccount, clearOnlineId } from './storage.js'

// profile.js это страница профиля, profile.html. Она показывает вошедшему игроку его
// статистику и список его партий, а ещё тут кнопка "Выйти". Если игрок не вошёл, вместо
// профиля форма входа и регистрации. Форма одна на всю игру и живёт только здесь, а не
// на странице игры. Сюда же страница игры пересылает друга, который открыл ссылку-приглашение,
// не войдя: после входа страница возвращает его по этой ссылке на страницу игры.
// Всё, что пришло с сервера, попадает на страницу через textContent и createElement,
// не через innerHTML: никнейм придумал другой человек.

// page это блок страницы с профилем, loginForm форма входа внутри него.
// invited это id партии из ?game=, если сюда переслала страница игры: друг открыл
// ссылку-приглашение, не войдя. Иначе null.
const page = document.querySelector('.profile')
const loginForm = page.querySelector('.login-form')
const invited = new URLSearchParams(location.search).get('game')

// RESULT_WORDS это итог партии словом для списка "Мои партии". Цвет точки дублируется
// словом, потому что красный и зелёный легко спутать.
const RESULT_WORDS = { playing: 'идёт', win: 'победа', loss: 'поражение', draw: 'ничья' }

// renderProfile(profile, panel) показывает строку статистики и список "Мои партии" внутри
// блока panel. profile это ответ getProfile. Каждая партия это ссылка /?game=ID на страницу
// игры, поэтому до неё можно дойти клавишей Tab и открыть Enter. Идущую партию страница игры
// покажет живой, законченную повтором. В ссылке цветная точка, итог словом и описание вида
// "3x3, K=3, против masha, ходов: 7, 15.11.2026". Число из game.created это время
// в миллисекундах, браузер сам превращает его в дату.
// dot это точка, link это ссылка на партию, item это строка списка.
function renderProfile(profile, panel) {
  const stats = panel.querySelector('.stats')
  const list = panel.querySelector('.my-games')
  list.replaceChildren()

  stats.textContent = `Победы ${profile.wins}, ничьи ${profile.draws}, `
    + `поражения ${profile.losses}, очки ${profile.points}`

  for (const game of profile.games) {
    const dot = document.createElement('span')
    dot.className = `dot ${game.result}`

    const date = new Date(game.created).toLocaleDateString('ru-RU')
    const link = document.createElement('a')
    link.className = 'game-item'
    link.href = `/?game=${encodeURIComponent(game.id)}`
    link.append(dot, `${RESULT_WORDS[game.result]}, ${game.N}x${game.N}, K=${game.K}, `
      + `против ${game.opponent}, ходов: ${game.moves}, ${date}`)

    const item = document.createElement('li')
    item.append(link)
    list.append(item)
  }

  if (profile.games.length === 0) {
    const empty = document.createElement('li')
    empty.textContent = 'Партий пока нет'
    list.append(empty)
  }
}

// showError(text) пишет текст в строку ошибок под профилем, пустая строка её очищает
function showError(text) {
  page.querySelector('.profile-error').textContent = text
}

// goToInvite() возвращает игрока на страницу игры по приглашению. replace, а не обычный
// переход: иначе кнопка "Назад" из партии вернула бы на эту пересылку.
function goToInvite() {
  location.replace(`/?game=${encodeURIComponent(invited)}`)
}

// showLoggedOut() показывает форму входа и прячет данные профиля. Если сюда переслали
// по приглашению, над формой видна подсказка "Войдите, чтобы принять приглашение".
function showLoggedOut() {
  page.querySelector('.logged-out').hidden = false
  page.querySelector('.invite-note').hidden = invited === null
  page.querySelector('.account').hidden = true
}

// showProfile() загружает профиль и рисует его. Если игрок не вошёл, сервер не спрашиваем,
// показываем форму входа. Если страницу открыли по приглашению (?game=) и игрок уже вошёл,
// например в другой вкладке, профиль не нужен: приглашение ждёт на странице игры.
// 401 значит, что токен больше не годится, например базу удалили: забываем его и показываем
// форму входа. Остальные ошибки пишем в строку ошибок.
async function showProfile() {
  showError('')
  if (!loadAccount()) {
    showLoggedOut()
    return
  }

  if (invited !== null) {
    goToInvite()
    return
  }

  try {
    const profile = await getProfile()
    page.querySelector('.logged-out').hidden = true
    page.querySelector('.account').hidden = false
    page.querySelector('.nickname').textContent = profile.nickname
    renderProfile(profile, page)
  } catch (error) {
    if (error.status === 401) {
      clearAccount()
      showLoggedOut()
      return
    }
    showError(error.message)
  }
}

// Форма входа. Обе кнопки отправляют форму, event.submitter говорит, какая из них нажата:
// "Регистрация" или "Войти". Enter в поле нажимает первую, то есть "Войти". send это функция
// из net.js, которую выбрала кнопка. Токен и никнейм из ответа запоминаются в хранилище.
// Профиль после входа сама не рисует, а зовёт showProfile: тот либо покажет профиль,
// либо уведёт по приглашению на страницу игры. Ошибки сервера ("Неверный никнейм или пароль",
// "Этот никнейм уже занят" и другие) пишутся в строку ошибок под формой.
loginForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  const nickname = loginForm.elements.nickname.value.trim()
  const password = loginForm.elements.password.value
  const send = event.submitter?.value === 'register' ? register : login

  try {
    saveAccount(await send(nickname, password))
  } catch (error) {
    showError(error.message)
    return
  }

  loginForm.reset()
  showProfile()
})

// Выход. Если сервер не ответил, из учётной записи выходим всё равно: токен забывает браузер.
// ttt.online тоже забываем: партия на странице игры принадлежала этому игроку.
page.querySelector('.btn-logout').addEventListener('click', async () => {
  try {
    await logout()
  } catch {
    // сервер мог не ответить, из учётной записи выходим всё равно
  }
  clearAccount()
  clearOnlineId()
  showLoggedOut()
})

// pageshow по той же причине, что и на странице рейтинга: по кнопке "Назад" браузер может
// показать страницу из памяти без запуска скрипта, и после партии остался бы старый список
// с мигающей точкой у уже законченной партии
window.addEventListener('pageshow', showProfile)
