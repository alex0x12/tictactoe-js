import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

// auth.js это пароли и токены. Всё берётся из встроенного модуля crypto, своей
// криптографии тут нет.

// hashPassword(password) возвращает строку "соль:хеш" в шестнадцатеричном виде, её и хранит
// база. Соль это 16 случайных байт, у каждого пароля своя. Благодаря ей у двух одинаковых
// паролей получаются разные хеши, и по базе не видно, кто выбрал один и тот же пароль.
// scryptSync считает хеш от пароля и соли намеренно медленно, чтобы перебор был дорогим.
// Зовётся при регистрации. salt это соль, hash это 64 байта хеша.
function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

// checkPassword(password, stored) говорит, подходит ли введённый пароль к записи из базы.
// Соль достаём из записи, хеш от введённого пароля считаем так же, как при регистрации,
// и сравниваем с сохранённым. timingSafeEqual сравнивает за одинаковое время, как бы рано
// ни нашлось отличие: обычное сравнение по времени ответа выдало бы, сколько первых
// байт угадано. Зовётся при входе. again это хеш введённого пароля.
function checkPassword(password, stored) {
  const [salt, hash] = stored.split(':')
  const again = scryptSync(password, salt, 64)
  return timingSafeEqual(again, Buffer.from(hash, 'hex'))
}

// newToken() возвращает новый токен: 16 случайных байт, 32 шестнадцатеричных символа.
// Угадать такой нельзя. Зовётся при регистрации и при каждом входе.
function newToken() {
  return randomBytes(16).toString('hex')
}

export { hashPassword, checkPassword, newToken }
