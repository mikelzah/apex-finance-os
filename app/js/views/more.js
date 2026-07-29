// Всё остальное: активы, налоги, история, ключевая ставка, настройки,
// резервная копия. Разделы, которые нужны не каждый день.

import * as U from '../ui.js';
import * as F from '../fmt.js';
import * as C from '../calc.js';
import * as D from '../dates.js';
import * as charts from '../charts.js';
import * as store from '../store.js';
import * as forms from '../forms.js';

const { h } = U;

export function render(ctx) {
  switch (ctx.sub) {
    case 'assets': return assets(ctx);
    case 'tax': return tax(ctx);
    case 'history': return history(ctx);
    case 'keyrate': return keyRate(ctx);
    case 'classes': return classes(ctx);
    case 'settings': return settings(ctx);
    case 'backup': return backup(ctx);
    default: return hub(ctx);
  }
}

export function title(sub) {
  return {
    assets: 'Активы',
    tax: 'Налог на проценты',
    history: 'История капитала',
    keyrate: 'Ключевая ставка ЦБ',
    classes: 'Классы по тикерам',
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
      U.row('Классы по тикерам', String(Object.keys(state.settings.classByTicker || {}).length), {
        sub: 'к какому классу относится бумага',
        onClick: () => ctx.go('more/classes'),
      }),
      U.row('Настройки', '', { onClick: () => ctx.go('more/settings') }),
      U.row('Резервная копия', backupAge == null ? 'ни разу' : `${F.days(backupAge)} назад`, {
        sub: 'данные живут только в этом телефоне',
        onClick: () => ctx.go('more/backup'),
        tag: backupAge == null || backupAge > (state.settings.backupReminderDays || 14) ? 'пора' : null,
        tagClass: 'sell',
      }),
    ]),
    U.card([
      h('h3', { text: 'Как устроена система' }),
      U.callout('Деньги живут только в активах. Цель — ярлык «на что отложено», а не отдельный кошелёк. Один актив привязывается строго к одной цели, иначе те же деньги посчитаются дважды.', 'info'),
      U.callout('Взнос и доход — разные типы операций. Взнос — то, что отложили сами, и только это считается дисциплиной. Доход — проценты, которые начислил банк.', 'info'),
      U.callout('Начисление процентов — это модель, а не факт. Банк считает по фактическим дням и округляет по-своему. Раз в месяц сверяйте расчётную операцию с приложением банка.', 'info'),
    ]),
    h('p', { class: 'version', text: 'APEX Finance OS · локальная версия' }),
  ];
}

// --------------------------------------------------------------------------

function assets(ctx) {
  const { state, today, refresh } = ctx;
  const order = { [C.STATUS_ACTIVE]: 0, [C.STATUS_FROZEN]: 1, [C.STATUS_PLANNED]: 2, [C.STATUS_SOLD]: 3 };
  const list = [...state.assets].sort((a, b) => {
    const byStatus = (order[a.status] ?? 4) - (order[b.status] ?? 4);
    if (byStatus) return byStatus;
    return C.assetValue(b, state.operations) - C.assetValue(a, state.operations);
  });

  return [
    U.card([
      U.sectionTitle('Активы', U.button('Добавить', () => forms.assetSheet(null, { onDone: refresh }), { kind: 'primary' })),
      ...list.map((a) => {
        const value = C.assetValue(a, state.operations);
        const gap = a.bankBalance != null ? a.bankBalance - value : null;
        return U.row(a.name, F.money(value), {
          sub: [a.type, a.liquidity, a.rate ? `${F.percent(a.rate, 2)} годовых` : null]
            .filter(Boolean)
            .join(' · '),
          tag: a.status === C.STATUS_ACTIVE ? (gap && Math.abs(gap) >= 1 ? 'расхождение' : null) : a.status,
          tagClass: gap && Math.abs(gap) >= 1 ? 'sell' : 'muted',
          onClick: () => forms.assetSheet(a, { onDone: refresh }),
        });
      }),
      list.length ? null : U.emptyState('Активов нет.'),
    ]),
    U.card([
      U.sectionTitle('Накопленные проценты'),
      ...C.pendingAccruals(state.assets, state.operations, today).map((p) =>
        U.row(p.asset.name, F.money2(p.accrued), {
          sub: p.asset.capDay ? `капитализация ${p.asset.capDay}-го` : 'день капитализации не задан',
        }),
      ),
      C.pendingAccruals(state.assets, state.operations, today).length
        ? null
        : U.emptyState('Активов с процентами нет.'),
      U.callout('Это расчётная оценка с последней капитализации, а не цифра из банка. В капитал она попадёт только после того, как вы запишете операцию «Доход».', 'info'),
    ]),
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
    U.card([
      U.callout('Считаются проценты по всем вашим вкладам и счетам во всех банках, а не только по заведённым здесь. Если есть счета вне приложения, добавьте их проценты вручную или заведите активы.', 'warn'),
      U.callout('Лимит — 1 млн ₽, умноженный на максимальную ключевую ставку на 1-е число месяца в течение года, и окончательно известен только по итогам года.', 'info'),
      U.callout('Налог начисляет ФНС, платить до 1 декабря следующего года. Это не налоговая консультация — просто арифметика по открытой формуле.', 'info'),
    ]),
  ];
}

// --------------------------------------------------------------------------

function history(ctx) {
  const { state, today, refresh } = ctx;
  const worth = C.netWorth(state.assets, state.operations);
  const rows = [...state.netWorth].sort((a, b) => (a.month < b.month ? 1 : -1));

  /**
   * Один снимок на месяц, строка перезаписывается. К концу месяца в ней
   * последнее известное состояние, а база не разрастается на 250 строк в год.
   */
  const snapshot = async () => {
    const month = D.month(today);
    await store.mutate((draft) => {
      const payload = {
        month,
        date: today,
        total: C.round2(worth.total),
        liquid: C.round2(worth.liquid),
        invested: C.round2(worth.invested),
      };
      const existing = draft.netWorth.find((r) => r.month === month);
      if (existing) Object.assign(existing, payload);
      else draft.netWorth.push(payload);
    });
    U.toast('Снимок записан');
    refresh();
  };

  return [
    U.card([
      U.sectionTitle('История капитала', U.button('Снимок за месяц', snapshot, { kind: 'primary' })),
      charts.line(
        rows.map((r) => ({ x: r.date, y: r.total })).reverse(),
        { hint: 'Нужно минимум два снимка' },
      ),
    ]),
    U.card([
      ...rows.map((r) =>
        U.row(F.monthName(r.month), F.money(r.total), {
          sub: `доступно ${F.money(r.liquid)} · инвестиции ${F.money(r.invested)}`,
        }),
      ),
      rows.length ? null : U.emptyState('Снимков ещё нет.'),
    ]),
    U.card([
      U.callout('Снимок пишется вручную, чтобы приложение не трогало историю без вашего ведома. Достаточно раз в месяц.', 'info'),
    ]),
  ];
}

// --------------------------------------------------------------------------

function keyRate(ctx) {
  const { state, today, refresh } = ctx;
  const rows = [...state.keyRate].sort((a, b) => (a.date < b.date ? 1 : -1));

  const add = () => {
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
        U.callout('Ставка ЦБ меняется несколько раз в год. Достаточно вносить точку в день изменения — лимит пересчитается сам.', 'info'),
      ];
    });
  };

  return [
    U.card([
      U.sectionTitle('Ключевая ставка ЦБ', U.button('Добавить', add, { kind: 'primary' })),
      U.stat('Действует сейчас', F.percent(C.rateOn(state.keyRate, today)), { big: true }),
      charts.line(
        rows.map((r) => ({ x: r.date, y: r.rate })).reverse(),
        { format: (v) => F.percent(v), hint: 'Нужно минимум две точки' },
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

// --------------------------------------------------------------------------

function classes(ctx) {
  const { state, refresh } = ctx;
  const map = state.settings.classByTicker || {};
  const tickers = [...new Set(state.assets.filter((a) => a.ticker).map((a) => a.ticker))];

  const edit = (ticker) => {
    U.sheet(ticker || 'Новое соответствие', (api) => {
      const t = U.input({ type: 'text', value: ticker || '', placeholder: 'GMKN' });
      const cls = U.input({ type: 'text', value: map[ticker] || '', placeholder: 'Акции' });
      api.setFooter([
        ticker
          ? U.button('Удалить', async () => {
              await store.mutate((draft) => {
                delete draft.settings.classByTicker[ticker];
              });
              api.close();
              refresh();
            }, { kind: 'danger' })
          : U.button('Отмена', () => api.close()),
        U.button('Сохранить', async () => {
          const key = t.value.trim().toUpperCase();
          if (!key || !cls.value.trim()) return U.toast('Заполните оба поля', 'error');
          await store.mutate((draft) => {
            if (ticker && ticker !== key) delete draft.settings.classByTicker[ticker];
            draft.settings.classByTicker[key] = cls.value.trim();
          });
          api.close();
          refresh();
        }, { kind: 'primary' }),
      ]);
      return [U.field('Тикер', t), U.field('Класс актива', cls)];
    });
  };

  const unmapped = tickers.filter((t) => !map[t]);

  return [
    U.card([
      U.sectionTitle('Классы по тикерам', U.button('Добавить', () => edit(null), { kind: 'primary' })),
      ...Object.entries(map).map(([ticker, cls]) =>
        U.row(ticker, cls, { onClick: () => edit(ticker) }),
      ),
      Object.keys(map).length ? null : U.emptyState('Соответствий нет.'),
    ]),
    unmapped.length
      ? U.card([
          U.callout(`Без класса: ${unmapped.join(', ')}. Эти бумаги попадут в «${state.settings.classFallback}».`, 'warn'),
        ])
      : null,
    U.card([
      U.callout('Активы без тикера — вклады, счета, недвижимость — тоже попадают в запасной класс. Это ожидаемо: целевая структура задаётся для торгуемых бумаг.', 'info'),
    ]),
  ];
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

  const asset = state.assets.find((a) => a.id === s.quickAssetId);

  return [
    U.card([
      U.row('Быстрый взнос', s.quickAmount ? F.money(s.quickAmount) : 'выключен', {
        sub: asset ? asset.name : 'актив не выбран',
        onClick: quick,
      }),
      U.row('Напоминание о копии', s.backupReminderDays ? `раз в ${F.days(s.backupReminderDays)}` : 'выключено', {
        onClick: reminder,
      }),
    ]),
    U.card([
      U.sectionTitle('Опасная зона'),
      U.button('Вернуть стартовые данные', () => {
        U.confirmSheet(
          'Вернуть стартовые данные?',
          'Всё, что вы завели в приложении, будет заменено слепком из Notion на 29.07.2026. Сделайте копию, если данные важны.',
          'Вернуть',
          async () => {
            await store.resetToSeed();
            U.toast('Стартовые данные восстановлены');
            refresh();
          },
        );
      }, { kind: 'danger' }),
      U.button('Стереть всё', () => {
        U.confirmSheet(
          'Стереть все данные?',
          'Активы, цели, операции и история исчезнут без возможности восстановления.',
          'Стереть',
          async () => {
            await store.wipe();
            U.toast('Данные стёрты');
            refresh();
          },
        );
      }, { kind: 'danger' }),
    ]),
  ];
}

// --------------------------------------------------------------------------

function backup(ctx) {
  const { state, today, refresh } = ctx;
  const last = state.meta.lastBackupAt;
  const age = last ? D.diffDays(today, last.slice(0, 10)) : null;

  const filename = () => `apex-finance-os-${today}.json`;

  const save = async () => {
    const text = store.exportText();
    const file = new File([text], filename(), { type: 'application/json' });

    // На iPhone это открывает системный лист: Файлы, iCloud, почта, мессенджер.
    // Куда именно ляжет копия — решаете вы, приложение не выбирает за вас.
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'APEX Finance OS' });
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
      U.callout('Загрузка из копии заменяет текущие данные целиком, а не дополняет их. Слияние двух разошедшихся журналов дало бы дубли, которые потом руками не разберёшь.', 'info'),
    ]),
  ];
}
