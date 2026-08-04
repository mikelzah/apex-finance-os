// Всё остальное: активы, налоги, история, ключевая ставка, настройки,
// резервная копия. Разделы, которые нужны не каждый день.

import * as U from '../ui.js';
import * as F from '../fmt.js';
import * as C from '../calc.js';
import * as D from '../dates.js';
import * as charts from '../charts.js';
import * as store from '../store.js';
import * as forms from '../forms.js';
import * as theme from '../theme.js';
import { BUILD } from '../build.js';
import * as mascot from '../mascot.js';
import * as lock from '../lock.js';
import { table } from '../table.js';
import * as S from '../statement.js';

const { h } = U;

/**
 * Шапка раздела. Действия у неё нет: «Настройки» — это перечень входов,
 * а не список, в который что-то добавляют. Круглый плюс здесь означал бы,
 * что настройку можно завести, — а завести можно только то, что за ними.
 */
export function head() {
  return U.screenHead('Настройки');
}

export function render(ctx) {
  switch (ctx.sub) {
    case 'assets': return assets(ctx);
    case 'tax': return tax(ctx);
    case 'history': return history(ctx);
    case 'health': return health(ctx);
    case 'keyrate': return keyRate(ctx);
    case 'settings': return settings(ctx);
    case 'backup': return backup(ctx);
    case 'categories': return categories(ctx);
    default: return hub(ctx);
  }
}

/**
 * Действие для шапки вложенного раздела. Кнопка живёт там, а не в теле
 * экрана: иначе заголовок раздела и заголовок экрана дублируют друг друга.
 */
export function action(sub, ctx) {
  if (sub === 'assets') {
    return U.button('Добавить', () => forms.assetSheet(null, { onDone: ctx.refresh }), { kind: 'primary' });
  }
  if (sub === 'keyrate') {
    return U.button('Добавить', () => keyRateSheet(ctx), { kind: 'primary' });
  }
  if (sub === 'categories') {
    return U.button('Добавить', () => categorySheet(ctx, 'spend', null), { kind: 'primary' });
  }
  return null;
}

export function title(sub) {
  return {
    assets: 'Активы',
    tax: 'Налог на проценты',
    history: 'История капитала',
    health: 'Проверка данных',
    keyrate: 'Ключевая ставка ЦБ',
    settings: 'Настройки',
    backup: 'Резервная копия',
    categories: 'Категории трат',
  }[sub] || 'Ещё';
}

// --------------------------------------------------------------------------

function hub(ctx) {
  const { state, today } = ctx;
  const worth = C.netWorth(state.assets, state.operations);
  const t = C.taxRow(state.tax, state.operations, state.keyRate, today, state.settings);
  const backupAge = state.meta.lastBackupAt
    ? D.diffDays(today, state.meta.lastBackupAt.slice(0, 10))
    : null;

  // Две группы под подписями вместо двух безымянных карточек подряд. Раньше
  // они отличались только тем, что между ними был промежуток, и понять,
  // почему «Ключевая ставка» выше этой границы, а «Категории» ниже, было
  // неоткуда.
  const late = backupAge == null || backupAge > (state.settings.backupReminderDays || 14);

  return [
    // Настройки приложения стоят первыми и прямо здесь, без вложенного
    // экрана. Прежде внутри этого списка была строка «Настройки», ведущая
    // ещё глубже, — после того как раздел сам стал называться «Настройки»,
    // это превратилось в путь «Настройки → Настройки», то есть в тупик.
    h('p', { class: 'caption', text: 'Приложение' }),
    U.card(appRows(ctx)),

    h('p', { class: 'caption', text: 'Данные' }),
    U.card([
      U.row('Активы', String(state.assets.length), { sub: F.money(worth.total), onClick: () => ctx.go('more/assets') }),
      (() => {
        const found = C.dataHealth(state, today);
        const errors = found.filter((x) => x.level === 'error').length;
        // Ошибка называет себя словом и краснеет. Прежде здесь стояло голое
        // число и серая метка «ошибки» рядом: «2» с тем же весом, что «24»
        // у категорий строкой ниже, — а это разные вещи, и одна из них
        // означает, что цифрам в приложении верить нельзя.
        return U.row('Проверка данных', errors ? '' : String(found.length || 'чисто'), {
          sub: 'находит то, что молча искажает цифры',
          onClick: () => ctx.go('more/health'),
          tag: errors ? `${errors} ${F.plural(errors, 'ошибка', 'ошибки', 'ошибок')}` : null,
          tagClass: 'error',
        });
      })(),
      U.row('Категории трат', String(
        S.categoriesOf(state.settings, 'spend').length + S.categoriesOf(state.settings, 'income').length,
      ), {
        sub: 'свой список для разбора трат',
        onClick: () => ctx.go('more/categories'),
      }),
      U.row('История капитала', `${state.netWorth.length}`, { sub: 'снимков по дням', onClick: () => ctx.go('more/history') }),
      U.row('Налог на проценты', F.money(t.received), { sub: `лимит ${F.money(t.limit)}`, onClick: () => ctx.go('more/tax') }),
      U.row('Ключевая ставка ЦБ', state.keyRate.length ? F.percent(C.rateOn(state.keyRate, today)) : '—', {
        sub: 'от неё считается налоговый лимит',
        onClick: () => ctx.go('more/keyrate'),
      }),
    ]),

    // Копия — отдельным блоком, а не строкой в общем списке: данные живут
    // только в этом телефоне, и это единственное место, откуда их можно
    // достать. Строкой среди шести других она читается рядовым пунктом.
    h('p', { class: 'caption', text: 'Резервная копия' }),
    U.card([
      h('div', { class: 'backup-head' }, [
        h('div', {}, [
          h('p', { class: 'backup-when', text: backupAge == null ? 'ни разу' : `${F.days(backupAge)} назад` }),
          h('p', {
            class: 'backup-sub',
            text: state.settings.backupReminderDays
              ? `напоминать раз в ${F.days(state.settings.backupReminderDays)}`
              : 'напоминание выключено',
          }),
        ]),
        late ? h('span', { class: 'tag tag-sell', text: 'пора' }) : null,
      ]),
      U.button('Выгрузить копию', () => ctx.go('more/backup'), { kind: 'primary', class: 'btn-wide' }),
      U.callout('Данные живут только в этом телефоне: сервера у приложения нет. Копия — единственный способ перенести их или вернуть после сброса.', 'info'),
    ]),

    h('p', { class: 'caption', text: 'О приложении' }),
    version(),
    h('p', { class: 'version', text: `${mascot.NAME} · локальная версия` }),
  ];
}

// --------------------------------------------------------------------------

function assets(ctx) {
  const { state, today, refresh } = ctx;
  const ops = state.operations;
  const alive = state.assets.filter((a) => a.status !== C.STATUS_SOLD);
  const total = alive.reduce((s, a) => s + C.assetValue(a, ops), 0);

  const rows = state.assets.map((a) => {
    const value = C.assetValue(a, ops);
    const gap = a.bankBalance != null ? a.bankBalance - value : null;
    return { asset: a, value, gap, share: total > 0 && a.status !== C.STATUS_SOLD ? value / total : null };
  });

  const accruals = C.pendingAccruals(state.assets, ops, today);

  return [
    U.card([
      table({
        rows,
        sortKey: 'value',
        dir: 'desc',
        onRow: (r) => forms.assetSheet(r.asset, { onDone: refresh }),
        empty: 'Активов нет. Добавьте первый — с него начнётся капитал.',
        columns: [
          {
            key: 'name',
            title: 'Название',
            value: (r) => r.asset.name,
            render: (r) => {
              const box = h('div');
              box.appendChild(h('div', { text: r.asset.name }));
              const sub = [r.asset.type, r.asset.rate ? F.percent(r.asset.rate, 2) : null]
                .filter(Boolean)
                .join(' · ');
              box.appendChild(h('div', { class: 'dt-dim', style: { fontSize: 'var(--text-micro)' }, text: sub }));
              return box;
            },
            total: () => 'Итого',
          },
          {
            key: 'value',
            title: 'Стоимость',
            align: 'right',
            value: (r) => r.value,
            render: (r) => F.money(r.value),
            total: () => F.money(total),
          },
          {
            key: 'share',
            title: 'Доля',
            align: 'right',
            value: (r) => r.share,
            render: (r) => (r.share == null ? '—' : F.share(r.share, 1)),
          },
          {
            key: 'status',
            title: 'Статус',
            value: (r) => r.asset.status,
            render: (r) => {
              if (r.gap && Math.abs(r.gap) >= 1) {
                return h('span', { class: 'tag tag-sell', text: 'расхождение' });
              }
              if (r.asset.status === C.STATUS_ACTIVE) return h('span', { class: 'dt-dim', text: 'активен' });
              return h('span', { class: 'tag tag-muted', text: r.asset.status.toLowerCase() });
            },
          },
        ],
      }),
    ], { class: 'card-table' }),

    accruals.length
      ? U.card([
          U.sectionTitle('Накопленные проценты'),
          ...accruals.map((p) =>
            U.row(p.asset.name, F.money2(p.accrued), {
              sub: p.asset.capDay ? `капитализация ${p.asset.capDay}-го` : 'день капитализации не задан',
            }),
          ),
        ])
      : null,
  ];
}

/**
 * Включение и выключение замка.
 *
 * При включении человек предупреждается о том, чего замок не делает, и о том,
 * чем он рискует. Данные не шифруются — это штора, а не сейф. Зато обходной
 * кнопки у неё нет, и потерянный ключ означает потерянный доступ: после
 * сброса устройства или удаления passkey войти будет нечем, а данные лежат
 * только в этом телефоне.
 */
function toggleLock(refresh) {
  if (lock.enabled()) {
    lock.disable();
    U.toast('Вход открыт');
    refresh();
    return;
  }
  U.confirmSheet(
    'Закрыть вход по Face ID?',
    'Приложение будет спрашивать Face ID при каждом запуске. Обойти это нельзя: '
    + 'если passkey пропадёт — сброс устройства, удаление ключа, — войти будет нечем, '
    + 'а данные лежат только в этом телефоне. Сделайте копию, прежде чем включать. '
    + 'И имейте в виду: сами данные не шифруются, замок закрывает экран, а не базу.',
    'Включить',
    async () => {
      try {
        await lock.enable();
        U.toast('Вход закрыт');
      } catch (err) {
        U.toast(`Не удалось: ${err.message}`, 'error');
      }
      refresh();
    },
    'primary',
  );
}

// --------------------------------------------------------------------------

/**
 * Проверка данных.
 *
 * Сигналы на главной говорят «пора что-то сделать». Этот экран говорит
 * «цифры, которые ты видишь, неверны» — и это тише и опаснее. Актив,
 * привязанный к двум целям, не подаёт никаких признаков: обе цели показывают
 * прогресс, которого нет, а сумма по ним больше капитала.
 */
function health(ctx) {
  const { state, today } = ctx;
  const found = C.dataHealth(state, today);

  if (!found.length) {
    return [U.card([
      mascot.portrait('health-mascot'),
      h('p', { class: 'health-ok', text: 'Всё сходится. Ничего, что искажало бы цифры, не нашлось.' }),
    ], { class: 'card-quiet' })];
  }

  const byLevel = [
    ['error', 'Искажают цифры'],
    ['warn', 'Считается не полностью'],
    ['info', 'Стоит заполнить'],
  ];

  return byLevel.map(([level, title]) => {
    const list = found.filter((x) => x.level === level);
    if (!list.length) return null;
    return U.card([
      U.sectionTitle(title, h('span', { class: 'section-sum', text: String(list.length) })),
      ...list.map((x) =>
        U.row(x.title, '', {
          sub: x.detail,
          onClick: () => ctx.go(x.go),
          tag: level === 'error' ? 'ошибка' : null,
          tagClass: 'sell',
        }),
      ),
    ]);
  });
}

// --------------------------------------------------------------------------

function tax(ctx) {
  const { state, today, refresh } = ctx;
  const year = D.parts(today).y;
  const row = C.taxRow(state.tax, state.operations, state.keyRate, today, state.settings);
  const computed = C.taxLimit(state.keyRate, today, state.settings.taxLimitBase || 1000000);

  const edit = () => {
    U.sheet(`Налог за ${year}`, (api) => {
      const ndfl = U.numberInput(row.ndflRate);
      const limit = U.numberInput(row.limit);
      const manual = U.checkbox('Лимит задан вручную', row.limitManual);

      api.setFooter([
        U.button('Отмена', () => api.close()),
        U.button('Сохранить', async () => {
          await store.mutate((draft) => {
            const existing = draft.tax.find((t) => t.year === year);
            const payload = {
              year,
              ndflRate: U.parseNumber(ndfl.value) ?? 13,
              limit: U.parseNumber(limit.value),
              limitManual: manual.box.checked,
              updated: today,
              notes: existing?.notes || null,
            };
            if (existing) Object.assign(existing, payload);
            else draft.tax.push(payload);
          });
          api.close();
          refresh();
        }, { kind: 'primary' }),
      ]);

      return [
        U.field('Ставка НДФЛ, %', ndfl),
        U.field('Необлагаемый лимит, ₽', limit,
          computed ? `Расчёт по ставке ЦБ: ${F.money(computed.limit)} при максимуме ${F.percent(computed.maxRate)}` : 'Ряд ключевой ставки пуст'),
        manual.node,
        U.callout('Без галочки лимит пересчитывается сам по ключевой ставке и может только расти в течение года.', 'info'),
      ];
    });
  };

  return [
    U.card([
      U.sectionTitle(`За ${year} год`, U.button('Изменить', edit)),
      h('div', { class: 'grid-2' }, [
        U.stat('Получено процентов', F.money(row.received)),
        U.stat('Необлагаемый лимит', F.money(row.limit)),
        U.stat('Превышение', row.taxable != null ? F.money(row.taxable) : '—'),
        U.stat('Налог к уплате', row.tax != null ? F.money(row.tax) : '—',
          { hint: `НДФЛ ${F.percent(row.ndflRate, 0)}`, class: row.tax ? 'is-bad' : '' }),
      ]),
      row.limit != null && row.received < row.limit
        ? charts.progress(row.received / row.limit)
        : null,
    ]),
  ];
}

// --------------------------------------------------------------------------

function history(ctx) {
  const { state, today, refresh } = ctx;
  const worth = C.netWorth(state.assets, state.operations);
  const series = C.growthSeries(state.assets, state.operations, state.netWorth, today, worth.total);
  const snaps = [...state.netWorth].filter((r) => D.isValid(r.date)).sort((a, b) => (a.date < b.date ? -1 : 1));
  const now = series && series[series.length - 1];

  const snapshot = async () => {
    const written = await store.snapshotWorth(today);
    U.toast(written ? `Снимок за ${F.date(today)} записан` : 'Капитал не менялся — снимок уже такой');
    refresh();
  };

  // Сколько бумаг мешает посчитать вложенное. Названы поимённо: «где-то
  // что-то не заполнено» отправляет искать вслепую.
  const blocking = state.assets.filter((a) => a.ticker && (a.quantity || 0) > 0);

  return [
    now
      ? U.card([
          U.stat('Капитал', F.money(now.total), { big: true }),
          h('div', { class: 'grid-2' }, [
            U.stat('Вложено своих', F.money(now.invested), { hint: 'взносы и покупки извне' }),
            U.stat(now.growth >= 0 ? 'Наросло' : 'Просело', F.signedMoney(now.growth), {
              class: now.growth >= 0 ? 'is-good' : 'is-bad',
              hint: now.invested > 0 ? `${F.percent((now.growth / now.invested) * 100)} к вложенному` : 'проценты и переоценка',
            }),
          ]),
        ])
      : U.card([
          U.stat('Капитал', F.money(worth.total), { big: true }),
          // Прирост здесь не показывается не из осторожности, а потому что
          // его нельзя посчитать: у бумаги, заведённой количеством, цена
          // покупки неизвестна, и вся её стоимость уехала бы в «наросло».
          U.callout(
            `Прирост не посчитать: ${blocking.map((a) => a.name).join(', ')} — заведены количеством, `
            + 'без сделки. Сколько за них заплачено, приложение не знает, и приняло бы всю их стоимость '
            + 'за прирост. Запишите покупку — и разложение появится.',
            'warn',
          ),
        ]),

    U.card([
      U.sectionTitle('История капитала', U.button('Снимок', snapshot, { kind: 'primary' })),
      snaps.length > 1
        ? charts.lines(
            snaps.map((r) => ({ x: r.date, y: r.total })),
            series ? series.map((r) => ({ x: r.date, y: r.invested })) : [],
            { label: 'Капитал', mainLabel: 'Капитал', secondLabel: 'Вложено' },
          )
        // Снимок пишется сам раз в день, поэтому «нужно ещё один» — это
        // не задача человеку, а честный срок: линия начнётся завтра.
        : U.emptyState(snaps.length
          ? 'Первая точка есть. Линия начнётся со второго дня — снимок записывается сам при каждом открытии.'
          : 'Снимков ещё нет.'),
    ]),

    snaps.length
      ? U.card([
          ...[...snaps].reverse().slice(0, 40).map((r) => {
            const row = series && series.find((x) => x.date === r.date);
            return U.row(F.date(r.date), F.money(r.total), {
              sub: row
                ? `вложено ${F.money(row.invested)} · ${row.growth >= 0 ? 'наросло' : 'просело'} ${F.signedMoney(row.growth)}`
                : `доступно ${F.money(r.liquid)} · инвестиции ${F.money(r.invested)}`,
              onClick: () => dropSnapshot(r, today, refresh),
            });
          }),
          U.callout('Нажмите на день, чтобы убрать снимок. Это нужно, когда актив ушёл из приложения задним числом: старый снимок продолжает помнить капитал вместе с ним.', 'info'),
        ])
      : null,
  ];
}

/**
 * Убрать снимок капитала.
 *
 * Единственный способ починить историю после того, как актив удалён задним
 * числом: снимок — это память о дне, пересчитать его не из чего. График при
 * этом перестаёт показывать обрыв, которого не было.
 *
 * Про снимок за сегодня говорим прямо, что он вернётся: он пишется сам при
 * каждом открытии, и «удалил, а он на месте» выглядело бы поломкой.
 */
function dropSnapshot(snap, today, refresh) {
  const tail = snap.date === today
    ? ' Снимок за сегодня запишется заново при следующем открытии — капитал берётся из активов.'
    : ' Точка пропадёт из истории и с графика. Вернуть её нельзя: пересчитать прошлый день не из чего.';
  U.confirmSheet(
    'Убрать снимок?',
    `${F.date(snap.date)} — ${F.money(snap.total)}.${tail}`,
    'Убрать',
    async () => {
      await store.removeSnapshot(snap.date);
      U.toast(`Снимок за ${F.date(snap.date)} убран`);
      refresh();
    },
  );
}

// --------------------------------------------------------------------------

function keyRate(ctx) {
  const { state, today, refresh } = ctx;
  const rows = [...state.keyRate].sort((a, b) => (a.date < b.date ? 1 : -1));

  return [
    U.card([
      U.stat('Действует сейчас', F.percent(C.rateOn(state.keyRate, today)), { big: true }),
      charts.line(
        rows.map((r) => ({ x: r.date, y: r.rate })).reverse(),
        { label: 'Ставка', format: (v) => F.percent(v), hint: 'Нужно минимум две точки' },
      ),
    ]),
    U.card([
      ...rows.map((r) =>
        U.row(F.date(r.date), F.percent(r.rate), {
          onClick: () => {
            U.confirmSheet('Удалить точку?', `${F.date(r.date)} — ${F.percent(r.rate)}`, 'Удалить', async () => {
              await store.mutate((draft) => {
                draft.keyRate = draft.keyRate.filter((x) => x.date !== r.date);
              });
              refresh();
            });
          },
        }),
      ),
      rows.length ? null : U.emptyState('Ряд пуст. Без него налоговый лимит не пересчитывается.'),
    ]),
  ];
}

function keyRateSheet(ctx) {
  const { today, refresh } = ctx;
  U.sheet('Точка ключевой ставки', (api) => {
    const date = U.input({ type: 'date', value: today });
    const rate = U.numberInput(null, { 'data-autofocus': 'yes' });
    api.setFooter([
      U.button('Отмена', () => api.close()),
      U.button('Сохранить', async () => {
        const value = U.parseNumber(rate.value);
        if (value == null) return U.toast('Введите ставку', 'error');
        await store.mutate((draft) => {
          const i = draft.keyRate.findIndex((r) => r.date === date.value);
          if (i === -1) draft.keyRate.push({ date: date.value, rate: value });
          else draft.keyRate[i].rate = value;
        });
        api.close();
        refresh();
      }, { kind: 'primary' }),
    ]);
    return [
      U.field('Дата изменения', date),
      U.field('Ставка, %', rate),
    ];
  });
}


// --------------------------------------------------------------------------

function settings(ctx) {
  const { state, refresh } = ctx;
  const s = state.settings;

  const save = async (patch) => {
    await store.mutate((draft) => Object.assign(draft.settings, patch));
    refresh();
  };

  const quick = () => {
    U.sheet('Быстрый взнос', (api) => {
      const amount = U.numberInput(s.quickAmount, { 'data-autofocus': 'yes' });
      const asset = U.select(
        [{ value: '', label: '— не задан —' }, ...state.assets.map((a) => ({ value: a.id, label: a.name }))],
        s.quickAssetId || '',
      );
      const goal = U.select(
        [{ value: '', label: '— без цели —' }, ...state.goals.map((g) => ({ value: g.id, label: g.name }))],
        s.quickGoalId || '',
      );
      api.setFooter([
        U.button('Отмена', () => api.close()),
        U.button('Сохранить', async () => {
          await save({
            quickAmount: U.parseNumber(amount.value),
            quickAssetId: asset.value || null,
            quickGoalId: goal.value || null,
          });
          api.close();
        }, { kind: 'primary' }),
      ]);
      return [
        U.field('Сумма, ₽', amount),
        U.field('Актив', asset),
        U.field('Цель', goal),
        U.callout('Это кнопка на главном экране. Пустая сумма или актив убирают её совсем.', 'info'),
      ];
    });
  };

  const reminder = () => {
    U.sheet('Напоминание о копии', (api) => {
      const days = U.numberInput(s.backupReminderDays, { 'data-autofocus': 'yes' });
      api.setFooter([
        U.button('Отмена', () => api.close()),
        U.button('Сохранить', async () => {
          await save({ backupReminderDays: U.parseNumber(days.value) || 14 });
          api.close();
        }, { kind: 'primary' }),
      ]);
      return [U.field('Раз в сколько дней напоминать', days), U.callout('0 — не напоминать.', 'info')];
    });
  };

  const themeSheet = () => {
    U.sheet('Тема', (api) => {
      const options = ['system', 'light', 'dark'];
      return options.map((mode) =>
        U.row(theme.label(mode), theme.preference() === mode ? '✓' : '', {
          sub: mode === 'system' ? `сейчас ${theme.label(theme.resolved()).toLowerCase()}` : null,
          onClick: () => {
            theme.set(mode);
            api.close();
            refresh();
          },
        }),
      );
    }, { focus: false });
  };

  const asset = state.assets.find((a) => a.id === s.quickAssetId);

  return [U.card(appRows(ctx, { themeSheet, quick, reminder })), version()];
}

/**
 * Строки настроек приложения.
 *
 * Живут отдельной функцией, потому что показываются в двух местах: прямо
 * в разделе и на прежнем адресе more/settings, который разослан в ярлыках.
 * Собирать их дважды значило бы однажды поправить одно и забыть другое.
 *
 * Переключатели отличаются от строк со значением не украшением, а обещанием:
 * строка со значением ведёт дальше, переключатель меняется на месте.
 */
function appRows(ctx, sheets) {
  const { state, refresh } = ctx;
  const s = state.settings;
  const asset = state.assets.find((a) => a.id === s.quickAssetId);

  // Когда строки собираются для самого раздела, шторок ещё нет: их создаёт
  // settings(). Тогда строка просто ведёт на прежний экран, где они есть.
  const open = (name) => (sheets ? sheets[name] : () => ctx.go('more/settings'));

  return [
    U.row('Тема', theme.label(), {
      sub: theme.preference() === 'system' ? `сейчас ${theme.label(theme.resolved()).toLowerCase()}` : null,
      onClick: open('themeSheet'),
    }),
    U.row('Быстрый взнос', s.quickAmount ? F.money(s.quickAmount) : 'выключен', {
      sub: asset ? asset.name : 'актив не выбран',
      onClick: open('quick'),
    }),
    U.row('Напоминание о копии', s.backupReminderDays ? `раз в ${F.days(s.backupReminderDays)}` : 'выключено', {
      onClick: open('reminder'),
    }),
    U.switchRow('Скрывать суммы', F.hidden(), {
      sub: 'вместо рублей — точки. Проценты и количества остаются',
      onChange: () => {
        F.setHidden(!F.hidden());
        U.tap();
        refresh();
      },
    }),
    lock.supported()
      ? U.switchRow('Вход по Face ID', lock.enabled(), {
          sub: lock.enabled() ? 'спрашивается при запуске' : 'закрывает приложение от чужих рук',
          onChange: () => toggleLock(refresh),
        })
      : null,
    U.switchRow(`${mascot.NAME} на острове`, mascot.enabled(), {
      sub: 'висит на Dynamic Island и радуется взносам',
      onChange: () => {
        mascot.setEnabled(!mascot.enabled());
        U.tap();
        refresh();
      },
    }),
  ];
}

/**
 * Версия и обновление.
 *
 * От прежней диагностики экрана осталась одна строка — та, ради которой всё
 * и заводилось. По внешнему виду невозможно понять, какая сборка открыта
 * на телефоне, и без этой строки несколько исправлений подряд проверялись
 * на копии двухдневной давности. Замеры вьюпорта своё отработали: оболочка
 * держит панель у края независимо от того, что отдаёт iOS, и смотреть там
 * больше не на что.
 */
function version() {
  return U.card([
    U.row('Сборка', BUILD, { sub: 'время выкладки по UTC' }),
    U.button('Обновить приложение', forceRefresh, { class: 'btn-wide' }),
    U.callout('Стирает сохранённую копию кода и перезагружает страницу. Данные не затрагиваются — они лежат отдельно.', 'info'),
  ]);
}

/**
 * Принудительное обновление.
 *
 * Обычно оно не нужно: service worker берёт код оболочки из сети. Но если на
 * устройстве уже застряла старая копия — а именно это и случилось, и несколько
 * исправлений подряд проверялись на сборке двухдневной давности — нужен способ
 * вычистить её, не переустанавливая приложение.
 *
 * Данные живут в IndexedDB и здесь не трогаются.
 */
async function forceRefresh() {
  // Занавес поднимается до работы, а не после: очистка кэша и перезагрузка
  // занимают секунду с лишним, и всё это время экран иначе просто белый.
  const shown = mascot.curtain('Обновляюсь…');
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    if (navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch (err) {
    document.querySelector('.curtain')?.remove();
    U.toast(`Не удалось очистить копию: ${err.message}`, 'error');
    return;
  }
  // Ждём, пока зверьки набегаются: перезагрузить раньше — значит показать
  // огрызок анимации, что хуже, чем не показывать её вовсе.
  await shown;
  location.reload();
}

// --------------------------------------------------------------------------

function backup(ctx) {
  const { state, today, refresh } = ctx;
  const last = state.meta.lastBackupAt;
  const age = last ? D.diffDays(today, last.slice(0, 10)) : null;

  // Латиницей: файл уходит в «Файлы», почту и мессенджеры, а кириллица
  // в имени переживает такую дорогу не везде.
  const filename = () => `kubysh-${today}.json`;

  const save = async () => {
    const text = store.exportText();
    const file = new File([text], filename(), { type: 'application/json' });

    // На iPhone это открывает системный лист: Файлы, iCloud, почта, мессенджер.
    // Куда именно ляжет копия — решаете вы, приложение не выбирает за вас.
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: mascot.NAME });
        await store.markBackedUp();
        refresh();
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }

    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = h('a', { href: url, download: filename() });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    await store.markBackedUp();
    refresh();
  };

  const load = () => {
    const picker = h('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' } });
    picker.addEventListener('change', async () => {
      const file = picker.files && picker.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        // Сначала читаем, потом спрашиваем, и только затем заменяем. Загрузка
        // стирает всё, что есть в приложении, и откатить её нечем: человек
        // должен увидеть, что приедет вместо этого, до того как это случится.
        const parsed = store.readCopy(text);
        const from = store.copyCounts(parsed);
        const now = store.getState();
        const assets = (n) => `${n} ${F.plural(n, 'актив', 'актива', 'активов')}`;
        const ops = (n) => `${n} ${F.plural(n, 'операция', 'операции', 'операций')}`;
        U.confirmSheet(
          'Заменить всё на копию?',
          `В копии${from.savedAt ? ` от ${F.date(from.savedAt)}` : ''}: ${assets(from.assets)}, ${ops(from.operations)}, `
          + `${from.goals} ${F.plural(from.goals, 'цель', 'цели', 'целей')}, `
          + `${from.spending} ${F.plural(from.spending, 'запись', 'записи', 'записей')} трат.`
          + ` Сейчас в приложении: ${assets(now.assets.length)}, ${ops(now.operations.length)}.`
          + ' Всё нынешнее пропадёт, вернуть его будет нечем.',
          'Заменить',
          async () => {
            const counts = await store.importText(text);
            U.toast(`Загружено: ${counts.assets} активов, ${counts.operations} операций`);
            refresh();
          },
        );
      } catch (err) {
        U.toast(`Не удалось загрузить: ${err.message}`, 'error');
      } finally {
        picker.remove();
      }
    });
    document.body.appendChild(picker);
    picker.click();
  };

  const counts = `${state.assets.length} активов · ${state.operations.length} операций · ${state.goals.length} целей`;

  return [
    U.card([
      U.stat('Последняя копия', age == null ? 'ни разу' : age === 0 ? 'сегодня' : `${F.days(age)} назад`, {
        big: true,
        hint: counts,
      }),
      U.button('Сохранить копию', save, { kind: 'primary', class: 'btn-wide' }),
      U.button('Загрузить из копии', load, { class: 'btn-wide' }),
    ]),
    U.card([
      U.callout('Данные хранятся только в этом телефоне. Очистка данных Safari, удаление приложения с домашнего экрана или потеря телефона стирают всё безвозвратно.', 'warn'),
    ]),
  ];
}

// --------------------------------------------------------------------------
// Категории
// --------------------------------------------------------------------------

/**
 * Свой список категорий.
 *
 * Встроенный набор — это начало разговора, а не его конец: у одного человека
 * половина трат уходит на детей, у другого детей нет вовсе, зато есть машина.
 * Поэтому список правится целиком, а записи при переименовании переезжают
 * вместе с ним.
 */
function categories(ctx) {
  const { state } = ctx;
  const spend = S.categoriesOf(state.settings, 'spend');
  const income = S.categoriesOf(state.settings, 'income');
  const stray = S.strayCategories(state.spending, state.settings);
  const used = (name) => state.spending.filter((r) => r.category === name).length;

  const line = (kind) => (name) => {
    const n = used(name);
    const fixed = name === (kind === 'income' ? S.FALLBACK_INCOME : S.FALLBACK_SPEND);
    return U.row(name, n ? `${n} ${F.plural(n, 'запись', 'записи', 'записей')}` : '—', {
      sub: fixed ? 'запасная — сюда попадает неопознанное' : null,
      onClick: fixed ? null : () => categorySheet(ctx, kind, name),
    });
  };

  return [
    U.card([
      U.sectionTitle('Траты'),
      ...spend.map(line('spend')),
    ]),
    U.card([
      U.sectionTitle('Доходы', U.button('Добавить', () => categorySheet(ctx, 'income', null))),
      ...income.map(line('income')),
    ]),

    // Категории из выписки, которых в списке нет. Банк присылает свои
    // названия — «Маркетплейсы», «Фастфуд», — и они оседают в записях,
    // не попадая в список выбора. Здесь их видно и можно принять.
    stray.length
      ? U.card([
          U.sectionTitle('Есть в записях, но не в списке'),
          ...stray.map((x) => U.row(x.name, `${x.count} ${F.plural(x.count, 'запись', 'записи', 'записей')}`, {
            sub: 'нажмите, чтобы добавить в список трат',
            onClick: async () => {
              await store.addCategory('spend', x.name);
              U.toast(`«${x.name}» в списке`);
              ctx.refresh();
            },
          })),
        ])
      : null,

    U.card([
      U.callout('Переименование меняет категорию и в записях. Удаление переводит их в запасную — суммы при этом не меняются.', 'info'),
      U.button('Вернуть список по умолчанию', () => {
        U.confirmSheet(
          'Вернуть начальный список?',
          'Свой список будет забыт. Записи останутся как есть — те категории, которых не станет в списке, окажутся в разделе «Есть в записях, но не в списке».',
          'Вернуть',
          async () => {
            await store.resetCategories();
            U.toast('Список по умолчанию');
            ctx.refresh();
          },
        );
      }, { class: 'btn-wide' }),
    ]),
  ];
}

function categorySheet(ctx, kind, name) {
  const isNew = !name;
  U.sheet(isNew ? 'Новая категория' : name, (api) => {
    const field = U.input({ type: 'text', value: name || '', 'data-autofocus': 'yes', maxlength: 40 });
    const where = U.select(
      [{ value: 'spend', label: 'Трата' }, { value: 'income', label: 'Доход' }],
      kind,
    );
    const count = name ? ctx.state.spending.filter((r) => r.category === name).length : 0;

    api.setFooter([
      isNew
        ? U.button('Отмена', () => api.close())
        : U.button('Удалить', () => {
            const fallback = kind === 'income' ? S.FALLBACK_INCOME : S.FALLBACK_SPEND;
            U.confirmSheet(
              `Удалить «${name}»?`,
              count
                ? `${count} ${F.plural(count, 'запись перейдёт', 'записи перейдут', 'записей перейдут')} в «${fallback}». Суммы не изменятся.`
                : 'Записей с этой категорией нет.',
              'Удалить',
              async () => {
                const moved = await store.removeCategory(kind, name);
                api.close();
                U.toast(moved ? `Перенесено записей: ${moved}` : 'Категория удалена');
                ctx.refresh();
              },
            );
          }, { kind: 'danger' }),
      U.button('Сохранить', async () => {
        const value = field.value.trim();
        if (!value) return U.toast('Название не может быть пустым', 'error');

        if (isNew) {
          const added = await store.addCategory(where.value, value);
          U.toast(added ? `«${value}» добавлена` : 'Такая категория уже есть', added ? 'ok' : 'error');
        } else {
          const touched = await store.renameCategory(kind, name, value);
          U.toast(touched ? `Переименовано, записей: ${touched}` : 'Переименовано');
        }
        api.close();
        ctx.refresh();
      }, { kind: 'primary' }),
    ]);

    return [
      U.field('Название', field),
      isNew ? U.field('Куда', where, 'Траты и доходы выбираются из разных списков') : null,
      !isNew && count
        ? h('p', { class: 'field-hint', text: `Записей с этой категорией: ${count}. Переименование затронет их все.` })
        : null,
    ];
  });
}
