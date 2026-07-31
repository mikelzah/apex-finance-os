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
import { table } from '../table.js';

const { h } = U;

export function render(ctx) {
  switch (ctx.sub) {
    case 'assets': return assets(ctx);
    case 'tax': return tax(ctx);
    case 'history': return history(ctx);
    case 'keyrate': return keyRate(ctx);
    case 'settings': return settings(ctx);
    case 'backup': return backup(ctx);
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
  return null;
}

export function title(sub) {
  return {
    assets: 'Активы',
    tax: 'Налог на проценты',
    history: 'История капитала',
    keyrate: 'Ключевая ставка ЦБ',
    settings: 'Настройки',
    backup: 'Резервная копия',
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

  return [
    U.card([
      U.row('Активы', String(state.assets.length), { sub: F.money(worth.total), onClick: () => ctx.go('more/assets') }),
      U.row('Налог на проценты', F.money(t.received), { sub: `лимит ${F.money(t.limit)}`, onClick: () => ctx.go('more/tax') }),
      U.row('История капитала', `${state.netWorth.length}`, { sub: 'снимков по месяцам', onClick: () => ctx.go('more/history') }),
      U.row('Ключевая ставка ЦБ', state.keyRate.length ? F.percent(C.rateOn(state.keyRate, today)) : '—', {
        sub: 'от неё считается налоговый лимит',
        onClick: () => ctx.go('more/keyrate'),
      }),
    ]),
    U.card([
      U.row('Настройки', '', { onClick: () => ctx.go('more/settings') }),
      U.row('Резервная копия', backupAge == null ? 'ни разу' : `${F.days(backupAge)} назад`, {
        sub: 'данные живут только в этом телефоне',
        onClick: () => ctx.go('more/backup'),
        tag: backupAge == null || backupAge > (state.settings.backupReminderDays || 14) ? 'пора' : null,
        tagClass: 'sell',
      }),
    ]),
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
  const rows = [...state.netWorth].sort((a, b) => (a.month < b.month ? 1 : -1));
  const series = C.growthSeries(state.assets, state.operations, state.netWorth, today, worth.total);
  const now = series[series.length - 1];

  /**
   * Один снимок на месяц, строка перезаписывается. К концу месяца в ней
   * последнее известное состояние, а база не разрастается на 250 строк в год.
   */
  const snapshot = async () => {
    await store.snapshotWorth(today);
    U.toast('Снимок записан');
    refresh();
  };

  return [
    // Главный вопрос экрана — не «сколько всего», а «сколько из этого моё
    // и сколько наросло само». Поэтому разложение стоит выше графика.
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
      : null,

    U.card([
      U.sectionTitle('История капитала', U.button('Снимок за месяц', snapshot, { kind: 'primary' })),
      series.length > 1
        ? charts.lines(
            series.map((r) => ({ x: r.date, y: r.total })),
            series.map((r) => ({ x: r.date, y: r.invested })),
            { label: 'Капитал', mainLabel: 'Капитал', secondLabel: 'Вложено' },
          )
        : charts.line([], { hint: 'Нужно минимум два снимка' }),
    ]),

    U.card([
      ...[...series].reverse().map((r) =>
        U.row(F.monthName(r.month), F.money(r.total), {
          sub: `вложено ${F.money(r.invested)} · ${r.growth >= 0 ? 'наросло' : 'просело'} ${F.signedMoney(r.growth)}`,
        }),
      ),
      rows.length ? null : U.emptyState('Снимков ещё нет.'),
    ]),
  ];
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

  return [
    U.card([
      U.row('Тема', theme.label(), {
        sub: theme.preference() === 'system' ? `сейчас ${theme.label(theme.resolved()).toLowerCase()}` : null,
        onClick: themeSheet,
      }),
      U.row('Быстрый взнос', s.quickAmount ? F.money(s.quickAmount) : 'выключен', {
        sub: asset ? asset.name : 'актив не выбран',
        onClick: quick,
      }),
      U.row('Напоминание о копии', s.backupReminderDays ? `раз в ${F.days(s.backupReminderDays)}` : 'выключено', {
        onClick: reminder,
      }),
      U.row(`${mascot.NAME} на острове`, mascot.enabled() ? 'висит' : 'выключен', {
        sub: 'висит на Dynamic Island и радуется взносам',
        onClick: () => {
          mascot.setEnabled(!mascot.enabled());
          refresh();
        },
      }),
    ]),
    version(),
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
        const counts = await store.importText(text);
        U.toast(`Загружено: ${counts.assets} активов, ${counts.operations} операций`);
        refresh();
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
