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

/**
 * Операция. Для бумаги это сделка, для счёта — движение денег.
 *
 * Развилка здесь, а не у каждого места вызова: операцию открывают из журнала,
 * со страницы бумаги, из карточки цели, и решать в каждой точке, какую форму
 * показать, значило бы четыре раза повторить одно правило.
 */
export function operationSheet(existing, options = {}) {
  const state = store.getState();
  if (C.isPaperOp(existing)) return tradeSheet(existing, options);
  if (!existing) {
    const target = state.assets.find((a) => a.id === options.assetId);
    if (target && target.ticker) return tradeSheet(null, options);
  }
  return moneySheet(existing, options);
}

function moneySheet(existing, options = {}) {
  const state = store.getState();
  const isNew = !existing;
  const op = existing || {
    id: null,
    date: D.today(),
    type: C.OP_CONTRIBUTION,
    amount: options.amount ?? state.settings.quickAmount ?? null,
    // По умолчанию — денежный актив, а не первый попавшийся: бумаги в этом
    // списке нет вовсе, и подставленный тикер оставил бы поле пустым.
    assetId: options.assetId ?? state.settings.quickAssetId
      ?? state.assets.find((a) => !a.ticker)?.id ?? null,
    goalId: options.goalId ?? state.settings.quickGoalId ?? null,
    source: C.SOURCE_MANUAL,
    comment: null,
  };

  U.sheet(isNew ? 'Новая операция' : 'Операция', (api) => {
    const date = U.input({ type: 'date', value: op.date });
    const type = U.select([C.OP_CONTRIBUTION, C.OP_INCOME, C.OP_EXPENSE], op.type);
    const amount = U.numberInput(op.amount, { 'data-autofocus': isNew ? 'yes' : 'no' });
    // Бумаг в списке нет: движение денег их стоимость не меняет — она
    // считается как количество × цена. Записанный на бумагу взнос ровно так
    // и пропадал. Уже записанную такую операцию из списка не выбрасываем,
    // иначе её нельзя было бы открыть и исправить.
    const asset = U.select(
      state.assets
        .filter((a) => !a.ticker || a.id === op.assetId)
        .map((a) => ({ value: a.id, label: a.name })),
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
// Сделка
// --------------------------------------------------------------------------

/**
 * Операция по бумаге: покупка, продажа, дивиденд, купон.
 *
 * Одна шторка на четыре вида, а не четыре шторки: половина полей у них общая —
 * бумага, дата, счёт, комментарий, — и разводить их по отдельным формам
 * значило бы четырежды повторить одно и то же. Меняется набор полей, а не
 * форма: у сделки спрашивается количество и цена, у выплаты — сумма
 * и удержанный налог.
 *
 * Сумма сделки не вводится, а считается — вводить её отдельно значит иметь
 * два источника одной величины и однажды их рассогласовать.
 *
 * Отдельно спрашивается счёт. Без него покупка увеличивала бы капитал
 * на стоимость бумаги, а дивиденд не увеличивал бы его вовсе: деньги пришли
 * бы ниоткуда и осели нигде. Поле можно оставить пустым — если счёт, через
 * который прошли деньги, здесь не ведётся.
 */
export function tradeSheet(existing, options = {}) {
  const state = store.getState();
  const isNew = !existing;
  const assets = state.assets.filter((a) => a.ticker);

  const op = existing || {
    id: null,
    date: D.today(),
    type: options.type || C.OP_BUY,
    assetId: options.assetId ?? assets[0]?.id ?? null,
    quantity: null,
    unitPrice: null,
    fee: null,
    tax: null,
    goalId: options.goalId ?? null,
    source: C.SOURCE_MANUAL,
    comment: null,
  };

  const assetOf = (id) => state.assets.find((a) => a.id === id) || null;
  const lotOf = (id) => assetOf(id)?.lotSize || 1;

  U.sheet(isNew ? 'Операция по бумаге' : op.type, (api) => {
    const type = U.select([C.OP_BUY, C.OP_SELL, C.OP_DIVIDEND, C.OP_COUPON], op.type);
    const asset = U.select(assets.map((a) => ({ value: a.id, label: a.name })), op.assetId);
    // В лотах — как в заявке у брокера. Штуки показываются рядом сами.
    const lots = U.numberInput(
      op.quantity != null ? op.quantity / lotOf(op.assetId) : null,
      { 'data-autofocus': isNew ? 'yes' : 'no' },
    );
    const unitPrice = U.numberInput(op.unitPrice ?? (isNew ? assetOf(op.assetId)?.price : null));
    const fee = U.numberInput(op.fee);
    // Выплата приходит суммой: делить её обратно на бумаги незачем, в отчёте
    // брокера она и стоит одной строкой.
    const gross = U.numberInput(C.isPayout(op) ? (op.amount || 0) + (op.tax || 0) : null);
    const tax = U.numberInput(op.tax);
    const date = U.input({ type: 'date', value: op.date });
    const cash = U.select(
      [
        { value: '', label: '— не указывать —' },
        ...state.assets.filter((a) => !a.ticker && a.type === C.TYPE_MONEY)
          .map((a) => ({ value: a.id, label: a.name })),
      ],
      isNew ? '' : store.linkedCashAsset(state.operations, op.id),
    );
    const goal = U.select(
      [{ value: '', label: '— без цели —' }, ...state.goals.map((g) => ({ value: g.id, label: g.name }))],
      op.goalId || '',
    );
    const comment = U.input({ type: 'text', value: op.comment || '', placeholder: 'необязательно' });

    const trade = () => C.isTrade({ type: type.value });

    const draft = () => {
      if (!trade()) {
        const g = U.parseNumber(gross.value) || 0;
        const t = U.parseNumber(tax.value) || 0;
        return { type: type.value, gross: g, tax: t, amount: Math.max(0, g - t) };
      }
      const lotSize = lotOf(asset.value);
      const qty = (U.parseNumber(lots.value) || 0) * lotSize;
      const d = {
        type: type.value,
        quantity: qty,
        unitPrice: U.parseNumber(unitPrice.value) || 0,
        fee: U.parseNumber(fee.value) || 0,
        lotSize,
      };
      return { ...d, amount: C.tradeAmount(d) };
    };

    // Итог пересчитывается на каждом нажатии клавиши: у брокера человек
    // привык видеть сумму до того, как подтвердит заявку.
    const totalValue = h('span', { class: 'total-value' });
    const totalNote = h('span', { class: 'total-note' });
    const rowLots = U.field('Количество, лотов', lots);
    const rowPrice = U.field('Цена за штуку, ₽', unitPrice);
    const rowFee = U.field('Комиссия, ₽', fee, 'Как в отчёте брокера. Покупку удорожает, из выручки вычитается.');
    const rowGross = U.field('Начислено, ₽', gross, 'Сумма до удержания налога — как в отчёте брокера.');
    const rowTax = U.field('Удержан налог, ₽', tax, 'Брокер удерживает его сам. В лимит по вкладам этот налог не входит.');

    const recount = () => {
      const d = draft();
      const isTrade = trade();
      for (const [node, on] of [[rowLots, isTrade], [rowPrice, isTrade], [rowFee, isTrade],
        [rowGross, !isTrade], [rowTax, !isTrade]]) node.hidden = !on;

      totalValue.textContent = F.money2(d.amount);
      totalNote.textContent = isTrade
        ? [
            `${F.num(d.quantity, 0)} шт × ${F.num(d.unitPrice, 4)} ₽`,
            d.fee ? `комиссия ${F.money2(d.fee)}` : null,
            d.lotSize > 1 ? `в лоте ${F.num(d.lotSize, 0)}` : null,
          ].filter(Boolean).join(' · ')
        : d.tax
          ? `начислено ${F.money2(d.gross)}, налог ${F.money2(d.tax)}`
          : 'налог не удерживался';
    };
    for (const node of [lots, unitPrice, fee, gross, tax]) node.addEventListener('input', recount);
    for (const node of [type, asset]) {
      node.addEventListener('change', () => {
        if (node === asset && isNew) unitPrice.value = String(assetOf(asset.value)?.price ?? '').replace('.', ',');
        recount();
      });
    }
    recount();

    api.setFooter([
      !isNew
        ? U.button('Удалить', () => {
            U.confirmSheet(`Удалить: ${op.type.toLowerCase()}?`,
              'Количество бумаг и движение денег по счёту откатятся.', 'Удалить', async () => {
                await store.mutate((d) => store.removePaperOp(d, op.id));
                U.toast('Операция удалена');
                options.onDone?.();
              });
          }, { kind: 'danger' })
        : U.button('Отмена', () => api.close()),
      U.button('Сохранить', async () => {
        const d = draft();
        if (!asset.value) return U.toast('Выберите бумагу', 'error');
        if (!D.isValid(date.value)) return U.toast('Проверьте дату', 'error');

        if (trade()) {
          if (!d.quantity || d.quantity <= 0) return U.toast('Количество должно быть больше нуля', 'error');
          if (!d.unitPrice || d.unitPrice <= 0) return U.toast('Цена должна быть больше нуля', 'error');
          // Продать больше, чем есть, нельзя: это не строгость ради строгости,
          // а защита от минусового количества, которое дальше пошло бы
          // в стоимость и в доли отрицательным числом.
          if (d.type === C.OP_SELL) {
            const others = state.operations.filter((x) => x.id !== op.id);
            const have = C.assetQuantity(assetOf(asset.value), others);
            if (d.quantity > have) return U.toast(`В наличии ${F.num(have, 0)} шт — продать больше нельзя`, 'error');
          }
        } else if (!d.amount || d.amount <= 0) {
          return U.toast('Сумма выплаты должна быть больше нуля', 'error');
        }

        const payload = {
          id: op.id || store.newId('op'),
          date: date.value,
          type: d.type,
          quantity: trade() ? d.quantity : null,
          unitPrice: trade() ? d.unitPrice : null,
          fee: trade() ? d.fee || null : null,
          tax: trade() ? null : d.tax || null,
          amount: d.amount,
          assetId: asset.value,
          ticker: assetOf(asset.value)?.ticker || null,
          goalId: goal.value || null,
          source: op.source || C.SOURCE_MANUAL,
          comment: comment.value.trim() || null,
        };
        await store.mutate((dr) => store.savePaperOp(dr, payload, cash.value || null));
        api.close();
        U.tap();
        U.toast(trade()
          ? `${d.type}: ${F.num(d.quantity, 0)} шт на ${F.money(payload.amount)}`
          : `${d.type}: ${F.money(payload.amount)}`);
        options.onDone?.();
      }, { kind: 'primary' }),
    ]);

    return [
      U.field('Тип операции', type),
      U.field('Бумага', asset),
      rowLots,
      rowPrice,
      rowFee,
      rowGross,
      rowTax,
      h('div', { class: 'total' }, [
        h('span', { class: 'total-label', text: 'Итого' }),
        totalValue,
        totalNote,
      ]),
      U.field('Дата', date),
      U.field('Счёт', cash, 'Отсюда спишутся деньги при покупке; при продаже и выплате — сюда зачислятся. Пусто — движение денег не записывать.'),
      U.field('Цель', goal),
      U.field('Комментарий', comment),
    ];
  });
}

// --------------------------------------------------------------------------
// Актив
// --------------------------------------------------------------------------

/**
 * Карточка актива. options.preset заполняет поля нового актива заранее —
 * с экрана портфеля бумагу заводят как бумагу, а не как счёт, и переключать
 * тип с «Деньги» на «Инвестиции» каждый раз незачем.
 */
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
    lotSize: 1,
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
    assetClass: null,
    ...(options.preset || {}),
  };

  U.sheet(isNew ? 'Новый актив' : a.name, (api) => {
    const name = U.input({ type: 'text', value: a.name, 'data-autofocus': isNew ? 'yes' : 'no' });
    const type = U.select([C.TYPE_MONEY, C.TYPE_INVESTMENT, 'Транспорт', 'Недвижимость'], a.type);
    const status = U.select([C.STATUS_ACTIVE, C.STATUS_FROZEN, C.STATUS_SOLD, C.STATUS_PLANNED], a.status);
    const liquidity = U.select([C.LIQUIDITY_INSTANT, 'T+1', 'Низкая'], a.liquidity);
    // Пустое значение — «не входит в расчёт долей». Так из портфеля выпадают
    // машина и квартира: они часть капитала, но не часть портфеля.
    const assetClass = U.select(
      [{ value: '', label: '— не входит в портфель —' }, ...C.ASSET_CLASSES.map((v) => ({ value: v, label: v }))],
      a.assetClass || '',
    );

    const ticker = U.input({ type: 'text', value: a.ticker || '', placeholder: 'пусто для активов без котировок' });
    const board = U.input({ type: 'text', value: a.board || '', placeholder: 'TQBR, TQTF' });
    const quantity = U.numberInput(a.quantity);
    const lotSize = U.numberInput(a.lotSize ?? 1);
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
          assetClass: assetClass.value || null,
          ticker: ticker.value.trim().toUpperCase() || null,
          board: board.value.trim().toUpperCase() || null,
          quantity: U.parseNumber(quantity.value),
          lotSize: U.parseNumber(lotSize.value) || 1,
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
      U.field('Класс в портфеле', assetClass, 'Определяет, в какую долю попадёт актив. Пусто — в расчёт долей не входит.'),

      // Раскрыта та половина полей, которая относится к этому активу:
      // у вклада нет режима торгов, у акции — дня капитализации. У новой
      // бумаги, заведённой с экрана портфеля, тикера ещё нет — открываем
      // по типу, иначе первое же поле пришлось бы искать за складкой.
      U.group('Котировки', Boolean(a.ticker) || (isNew && a.type === C.TYPE_INVESTMENT), [
        U.field('Тикер', ticker),
        U.field('Режим торгов', board, 'TQBR для акций, TQTF для фондов. Пусто — переберём сами.'),
        U.field('Количество на начало, шт', quantity, 'Сколько было на момент заведения бумаги. Сделки прибавляются к нему сами — правьте это поле, только если ошиблись в исходном остатке.'),
        U.field('Бумаг в лоте', lotSize, 'Сколько бумаг в одном лоте на бирже. Обычно 1 или 10 — по нему считается количество в сделке.'),
        U.field('Цена, ₽', price, a.updated ? `Обновлена ${F.date(a.updated)}` : 'Обновляется с Мосбиржи или вручную'),
      ]),

      U.group('Остаток', !a.ticker && !(isNew && a.type === C.TYPE_INVESTMENT), [
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
          // Новая цель встаёт в конец списка. Порядок задаёт человек
          // перетаскиванием, и подставлять новую в середину незачем.
          sort: Number.isFinite(g.sort) ? g.sort : store.getState().goals.length,
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

export function portfolioSheet(row, options = {}) {
  U.sheet(row.class, (api) => {
    const target = U.numberInput(row.targetShare, { 'data-autofocus': 'yes' });

    api.setFooter([
      U.button('Отмена', () => api.close()),
      U.button('Сохранить', async () => {
        await store.mutate((draft) => {
          const existing = draft.portfolio.find((r) => r.class === row.class);
          const value = U.parseNumber(target.value);
          if (existing) existing.targetShare = value;
          else draft.portfolio.push({ id: store.newId('cls'), class: row.class, targetShare: value });
        });
        api.close();
        options.onDone?.();
      }, { kind: 'primary' }),
    ]);

    // Названия классов не редактируются: список закрытый, и он же предлагается
    // в карточке актива. Разъехавшиеся названия означали бы деньги, потерянные
    // между классом актива и строкой целевой структуры.
    return [U.field('Целевая доля, %', target, 'Пусто — доля не задана, действие по классу не считается.')];
  });
}
