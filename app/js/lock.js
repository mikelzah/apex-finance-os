// Замок на вход по passkey.
//
// Чего он не делает, надо сказать прямо. Данные лежат в IndexedDB как есть
// и никак не шифруются: тот, кто откроет базу через инструменты разработчика
// или вытащит её с разблокированного телефона, увидит всё. Замок — это штора,
// а не сейф. Он закрывает ровно один случай, зато самый частый: телефон
// разблокирован и оказался в чужих руках — показать фотографию, дать позвонить.
//
// Отсюда и устройство: проверка ключа при запуске, без обходной кнопки.
// Обходная кнопка превратила бы штору в занавеску, нарисованную на стене.
// Поэтому при включении человек предупреждается, что потерянный ключ —
// это потерянный доступ, и что копия данных на этот случай обязательна.

import { shell } from './ui.js';
import * as mascot from './mascot.js';

const KEY = 'apex-finance-os:lock';

export function supported() {
  return Boolean(window.PublicKeyCredential && navigator.credentials);
}

export function enabled() {
  return Boolean(localStorage.getItem(KEY));
}

function randomBytes(n) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return a;
}

/**
 * Завести ключ.
 *
 * Тип ключа — только встроенный в устройство: Face ID, Touch ID, код-пароль.
 * Ключ с флешки на телефоне бесполезен, а список без ограничения заставляет
 * систему спрашивать «где хранить», чего в этом месте объяснять нечем.
 */
export async function enable() {
  if (!supported()) throw new Error('Устройство не умеет passkey');
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(32),
      rp: { name: mascot.NAME },
      user: { id: randomBytes(16), name: mascot.NAME, displayName: mascot.NAME },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
      timeout: 60000,
      attestation: 'none',
    },
  });
  if (!cred) throw new Error('Ключ не создан');
  localStorage.setItem(KEY, bufferToBase64(cred.rawId));
}

export function disable() {
  localStorage.removeItem(KEY);
}

/** Спросить ключ. Возвращает true, если человек подтвердил, что это он. */
export async function verify() {
  const id = localStorage.getItem(KEY);
  if (!id) return true;
  const cred = await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      allowCredentials: [{ type: 'public-key', id: base64ToBuffer(id) }],
      userVerification: 'required',
      timeout: 60000,
    },
  });
  return Boolean(cred);
}

/**
 * Экран замка.
 *
 * Держит обещание не пускать: пока проверка не пройдена, под ним ничего
 * не отрисовано вовсе — не спрятано стилем, а не построено. Спрятанное стилем
 * читается снимком экрана и деревом элементов.
 */
export function screen(onPass) {
  const wrap = document.createElement('div');
  wrap.className = 'lock';

  const button = document.createElement('button');
  button.className = 'btn btn-primary btn-wide';
  button.type = 'button';
  button.textContent = 'Войти';

  const note = document.createElement('p');
  note.className = 'lock-note';

  const ask = async () => {
    button.disabled = true;
    note.textContent = '';
    try {
      if (await verify()) {
        wrap.remove();
        onPass();
        return;
      }
      note.textContent = 'Не подтвердилось. Попробуйте ещё раз.';
    } catch (err) {
      note.textContent = err && err.name === 'NotAllowedError'
        ? 'Вход отменён.'
        : `Не удалось проверить ключ: ${err.message}`;
    }
    button.disabled = false;
  };

  button.addEventListener('click', ask);

  wrap.appendChild(mascot.portrait('lock-mascot'));
  const title = document.createElement('h1');
  title.className = 'lock-title';
  title.textContent = mascot.NAME;
  wrap.appendChild(title);
  wrap.appendChild(button);
  wrap.appendChild(note);
  shell().appendChild(wrap);

  // Спрашиваем сразу: лишнее нажатие на пути к собственным деньгам никому
  // не нужно, а кнопка остаётся для второй попытки.
  ask();
}

function bufferToBase64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function base64ToBuffer(text) {
  return Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0));
}
