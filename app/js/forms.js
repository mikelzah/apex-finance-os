// Формы ввода. Все они живут в шторке снизу — на телефоне это единственный
// способ показать форму, не отнимая контекст у экрана под ней.

import * as U from './ui.js';
import * as C from './calc.js';
import * as D from './dates.js';
import * as F from './fmt.js';
import * as store from './store.js';

const { h } = U;

// --------------------------------------------------------------------------
// Операция
// --------------------------------------------------------------------------

export function operationSheet(existing, options = {}) {
  const state = store.getState();
  const isNew = !existing;
  const op = existing || {
    id: null,
    date: D.today(),
    type: C.OP_CONTRIBUTION,
    amount: options.amount ?? state.settings.quickAmount ?? null,
    assetId: options.assetId ?? state.settings.quickAssetId ?? state.assets[0]?.id ?? null,
    goalId: options.goalId ?? state.settings.quickGoalId ?? null,
    source: C.SOURCE_MANUAL,
    comment: null,
  };

  U.sheet(isNew ? 'Новая операция' : 'Операция', (api) => {
    const date = U.input({ type: 'date', value: op.date });
    const type = U.select([C.OP_CONTRIBUTION, C.OP_INCOME, C.OP_EXPENSE], op.type);
    const amount = U.numberInput(op.amount, { 'data-autofocus': isNew ? 'yes' : 'no' });
    const asset = U.select(
      state.assets.map((a) => ({ value: a.id, label: a.name })),
      op.assetId,
    );
    const goal = U.select(
      [{ value: '', label: '— без цели —' }, ...state.goals.map((g) => ({ value: g.id, label: g.name }))],
      op.goalId || '',
    );
    const comment = U.input({ type: 'text', value: op.comment || '', placeholder: 'необязательно' });

    api.setFooter([
      !isNew
        ? U.button('Удалить', () => {
            U.confirmSheet('Удалить операцию?', 'Остаток актива и прогресс цели пересчитаются.', 'Удалить', async () => {
              await store.mutate((draft) => store.remove(draft.operations, op.id));
              U.toast('Операция удалена');
              options.onDone?.();
            });
          }, { kind: 'danger' })
        : U.button('Отмена', () => api.close()),
      U.button('Сохранить', async () => {
        const value = U.parseNumber(amount.value);
        if (value == null || value <= 0) return U.toast('Сумма должна быть больше нуля', 'error');
        if (!D.isValid(date.value)) return U.toast('Проверьте дату', 'error');

        const payload = {
          id: op.id || store.newId('op'),
          date: date.value,
          type: type.value,
          amount: value,
          assetId: asset.value || null,
          goalId: goal.value || null,
          source: op.source || C.SOURCE_MANUAL,
          comment: comment.value.trim() || null,
        };
        await store.mutate((draft) => store.upsert(draft.operations, payload));
        api.close();
        U.tap();
        U.toast(isNew ? `${type.value} ${F.money(value)} записан` : 'Операция сохранена');
        options.onDone?.();
      }, { kind: 'primary' }),
    ]);

    return [
      U.field('Сумма, ₽', amount),
      U.field('Тип', type, 'Взнос — то, что отложили сами. Доход — то, что начислил банк. В дисциплину идут только взносы.'),
      U.field('Дата', date),
      U.field('Актив', asset, 'Куда легли деньги. Остаток актива пересчитается сам.'),
      U.field('Цель', goal),
      U.field('Комментарий', comment),
      !isNew && op.source === C.SOURCE_COMPUTED
        ? U.callout('Операция создана расчётом процентов. Сверьте с приложением банка и поправьте сумму, если расходится.', 'warn')
        : null,
    ];
  });
}

// --------------------------------------------------------------------------
// Актив
// --------------------------------------------------------------------------

export function assetSheet(existing, options = {}) {
  const state = store.getState();
  const isNew = !existing;
  const a = existing || {
    id: null,
    name: '',
    type: C.TYPE_MONEY,
    status: C.STATUS_ACTIVE,
    liquidity: C.LIQUIDITY_INSTANT,
    ticker: null,
    board: null,
    quantity: null,
    price: null,
    updated: null,
    opening: 0,
    openingDate: D.today(),
    rate: null,
    capDay: null,
    capDaily: false,
    lastCap: null,
    maturitySum: false,
    maturityDate: null,
    bankBalance: null,
    reconciledAt: null,
    goalIds: [],
    notes: '',
  };

  U.sheet(isNew ? 'Новый актив' : a.name, (api) => {
    const name = U.input({ type: 'text', value: a.name, 'data-autofocus': isNew ? 'yes' : 'no' });
    const type = U.select([C.TYPE_MONEY, C.TYPE_INVESTMENT, 'Транспорт', 'Недвижимость'], a.type);
    const status = U.select([C.STATUS_ACTIVE, C.STATUS_FROZEN, C.STATUS_SOLD, C.STATUS_PLANNED], a.status);
    const liquidity = U.select([C.LIQUIDITY_INSTANT, 'T+1', 'Низкая'], a.liquidity);

    const ticker = U.input({ type: 'text', value: a.ticker || '', placeholder: 'пусто для активов без котировок' });
    const board = U.input({ type: 'text', value: a.board || '', placeholder: 'TQBR, TQTF' });
    const quantity = U.numberInput(a.quantity);
    const price = U.numberInput(a.price);

    const opening = U.numberInput(a.opening);
    const openingDate = U.input({ type: 'date', value: a.openingDate || '' });

    const rate = U.numberInput(a.rate);
    const capDay = U.numberInput(a.capDay);
    const capDaily = U.checkbox('Ежедневная капитализация', a.capDaily);
    const lastCap = U.input({ type: 'date', value: a.lastCap || '' });
    const maturitySum = U.checkbox('В остатке указана сумма на выходе', a.maturitySum);
    const maturityDate = U.input({ type: 'date', value: a.maturityDate || '' });

    const bankBalance = U.numberInput(a.bankBalance);
    const reconciledAt = U.input({ type: 'date', value: a.reconciledAt || '' });
    const notes = U.textarea(a.notes);

    const goalBoxes = state.goals.map((g) => {
      const c = U.checkbox(g.name, (a.goalIds || []).includes(g.id));
      c.box.dataset.goalId = g.id;
      return c;
    });

    api.setFooter([
      !isNew
        ? U.button('Удалить', () => {
            const used = state.operations.filter((op) => op.assetId === a.id).length;
            U.confirmSheet(
              'Удалить актив?',
              used
                ? `К активу привязано операций: ${used}. Они останутся в журнале, но перестанут влиять на капитал.`
                : 'Актив исчезнет из капитала и целей.',
              'Удалить',
              async () => {
                await store.mutate((draft) => store.remove(draft.assets, a.id));
                U.toast('Актив удалён');
                options.onDone?.();
              },
            );
          }, { kind: 'danger' })
        : U.button('Отмена', () => api.close()),
      U.button('Сохранить', async () => {
        if (!name.value.trim()) return U.toast('Название обязательно', 'error');
        const payload = {
          id: a.id || store.newId('asset'),
          name: name.value.trim(),
          type: type.value,
          status: status.value,
          liquidity: liquidity.value,
          ticker: ticker.value.trim().toUpperCase() || null,
          board: board.value.trim().toUpperCase() || null,
          quantity: U.parseNumber(quantity.value),
          price: U.parseNumber(price.value),
          updated: a.updated,
          opening: U.parseNumber(opening.value) || 0,
          openingDate: openingDate.value || null,
          rate: U.parseNumber(rate.value),
          capDay: U.parseNumber(capDay.value),
          capDaily: capDaily.box.checked,
          lastCap: lastCap.value || null,
          accrued: a.accrued ?? null,
          maturitySum: maturitySum.box.checked,
          maturityDate: maturityDate.value || null,
          bankBalance: U.parseNumber(bankBalance.value),
          reconciledAt: reconciledAt.value || null,
          goalIds: goalBoxes.filter((c) => c.box.checked).map((c) => c.box.dataset.goalId),
          notes: notes.value.trim() || null,
        };
        await store.mutate((draft) => store.upsert(draft.assets, payload));
        api.close();
        U.toast('Актив сохранён');
        options.onDone?.();
      }, { kind: 'primary' }),
    ]);

    return [
      U.field('Название', name),
      U.field('Тип', type),
      U.field('Статус', status),
      U.field('Ликвидность', liquidity, 'Мгновенная — попадает в «Доступно сегодня».'),

      // Раскрыта та половина полей, которая относится к этому активу:
      // у вклада нет режима торгов, у акции — дня капитализации.
      U.group('Котировки', Boolean(a.ticker), [
        U.field('Тикер', ticker),
        U.field('Режим торгов', board, 'TQBR для акций, TQTF для фондов. Пусто — переберём сами.'),
        U.field('Количество', quantity),
        U.field('Цена, ₽', price, a.updated ? `Обновлена ${F.date(a.updated)}` : 'Обновляется с Мосбиржи или вручную'),
      ]),

      U.group('Остаток', !a.ticker, [
        U.field('Начальный остаток, ₽', opening, 'Баланс на момент заведения актива, а не текущий. Иначе сегодняшний взнос посчитается дважды.'),
        U.field('Дата начального остатка', openingDate),
      ]),

      U.group('Проценты', Boolean(a.rate || a.maturitySum), [
        U.field('Ставка, % годовых', rate),
        U.field('День капитализации', capDay, 'Число месяца, когда создаётся операция «Доход». Пусто — автоначисления нет.'),
        capDaily.node,
        U.field('Последняя капитализация', lastCap, 'Отсчёт процентов идёт с этой даты. Поставьте один раз, дальше ведётся само.'),
        maturitySum.node,
        U.field('Дата погашения', maturityDate),
        U.callout('«Сумма на выходе» отключает начисление: проценты уже заложены в остаток, начислять их второй раз значило бы посчитать доход дважды.', 'info'),
      ]),

      U.group('Сверка с банком', a.bankBalance != null || Boolean(a.reconciledAt), [
        U.field('Остаток по банку, ₽', bankBalance),
        U.field('Дата сверки', reconciledAt),
      ]),

      U.group('Цели', (a.goalIds || []).length > 0, [
        ...goalBoxes.map((c) => c.node),
        U.callout('Один актив — одна цель. Две галочки означают, что те же деньги посчитаются в обеих целях.', 'warn'),
      ]),

      U.field('Заметки', notes),
    ];
  });
}

// --------------------------------------------------------------------------
// Цель
// --------------------------------------------------------------------------

export function goalSheet(existing, options = {}) {
  const isNew = !existing;
  const g = existing || {
    id: null,
    name: '',
    target: null,
    deadline: null,
    planPerDay: null,
    status: C.GOAL_ACTIVE,
  };

  U.sheet(isNew ? 'Новая цель' : g.name, (api) => {
    const name = U.input({ type: 'text', value: g.name, 'data-autofocus': isNew ? 'yes' : 'no' });
    const target = U.numberInput(g.target);
    const deadline = U.input({ type: 'date', value: g.deadline || '' });
    const plan = U.numberInput(g.planPerDay);
    const status = U.select([C.GOAL_ACTIVE, C.GOAL_PAUSED, C.GOAL_DONE], g.status);

    api.setFooter([
      !isNew
        ? U.button('Удалить', () => {
            U.confirmSheet('Удалить цель?', 'Активы останутся, но потеряют привязку к ней.', 'Удалить', async () => {
              await store.mutate((draft) => {
                store.remove(draft.goals, g.id);
                for (const a of draft.assets) {
                  a.goalIds = (a.goalIds || []).filter((id) => id !== g.id);
                }
                for (const op of draft.operations) {
                  if (op.goalId === g.id) op.goalId = null;
                }
              });
              U.toast('Цель удалена');
              options.onDone?.();
            });
          }, { kind: 'danger' })
        : U.button('Отмена', () => api.close()),
      U.button('Сохранить', async () => {
        if (!name.value.trim()) return U.toast('Название обязательно', 'error');
        const payload = {
          id: g.id || store.newId('goal'),
          name: name.value.trim(),
          target: U.parseNumber(target.value),
          deadline: deadline.value || null,
          planPerDay: U.parseNumber(plan.value),
          status: status.value,
        };
        await store.mutate((draft) => store.upsert(draft.goals, payload));
        api.close();
        U.toast('Цель сохранена');
        options.onDone?.();
      }, { kind: 'primary' }),
    ]);

    return [
      U.field('Название', name),
      U.field('Сумма цели, ₽', target),
      U.field('Срок', deadline),
      U.field('План в день, ₽', plan, 'Сколько собираетесь откладывать. От этого считается «Выполнение плана».'),
      U.field('Статус', status),
      U.callout('Прогресс цели — это сумма стоимостей привязанных активов. Привязка задаётся в карточке актива.', 'info'),
    ];
  });
}

// --------------------------------------------------------------------------
// Класс портфеля
// --------------------------------------------------------------------------

export function portfolioSheet(existing, options = {}) {
  const isNew = !existing;
  const p = existing || { id: null, class: '', targetShare: null };

  U.sheet(isNew ? 'Новый класс' : p.class, (api) => {
    const name = U.input({ type: 'text', value: p.class, 'data-autofocus': isNew ? 'yes' : 'no' });
    const target = U.numberInput(p.targetShare);

    api.setFooter([
      !isNew
        ? U.button('Удалить', async () => {
            await store.mutate((draft) => store.remove(draft.portfolio, p.id));
            api.close();
            U.toast('Класс удалён');
            options.onDone?.();
          }, { kind: 'danger' })
        : U.button('Отмена', () => api.close()),
      U.button('Сохранить', async () => {
        if (!name.value.trim()) return U.toast('Название класса обязательно', 'error');
        await store.mutate((draft) =>
          store.upsert(draft.portfolio, {
            id: p.id || store.newId('cls'),
            class: name.value.trim(),
            targetShare: U.parseNumber(target.value),
          }),
        );
        api.close();
        options.onDone?.();
      }, { kind: 'primary' }),
    ]);

    return [
      U.field('Класс актива', name),
      U.field('Целевая доля, %', target),
      U.callout('Актив попадает в класс по тикеру. Соответствие настраивается в разделе «Ещё → Классы по тикерам».', 'info'),
    ];
  });
}
