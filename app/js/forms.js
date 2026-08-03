// Формы ввода. Все они живут в шторке снизу — на телефоне это единственный
// способ показать форму, не отнимая контекст у экрана под ней.

import * as U from './ui.js';
import * as C from './calc.js';
import * as D from './dates.js';
import * as F from './fmt.js';
import * as store from './store.js';
import * as mascot from './mascot.js';

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
    // Сумма набирается крупно: её вводят, глядя на клавиатуру, а не на экран,
    // и проверяют одним взглядом, не вчитываясь.
    const amount = U.numberInput(op.amount, {
      class: 'control control-big',
      'data-autofocus': isNew ? 'yes' : 'no',
    });
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
      U.field('Тип', type),
      U.field('Дата', date),
      U.field('Актив', asset),
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
    const unitPrice = U.numberInput(
      op.quoted ?? op.unitPrice ?? (isNew ? assetOf(op.assetId)?.price : null),
    );
    const fee = U.numberInput(op.fee);
    // НКД по сделке с облигацией: покупатель платит его продавцу сверх цены,
    // и в отчёте брокера он стоит отдельной строкой. Считать его самим
    // приложением нельзя — брокер берёт свою дату расчётов, и копейки
    // разошлись бы с отчётом.
    const nkd = U.numberInput(op.nkd);
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
      const target = assetOf(asset.value);
      const isBond = C.isBond(target);
      const lotSize = lotOf(asset.value);
      const qty = (U.parseNumber(lots.value) || 0) * lotSize;
      const quoted = U.parseNumber(unitPrice.value) || 0;
      const perBond = U.parseNumber(nkd.value) || 0;
      // У облигации котировка в процентах от номинала, и деньги считаются
      // от рублёвой цены: проценты сами по себе не складываются с комиссией.
      const price = isBond ? (quoted / 100) * (target.faceValue || 0) + perBond : quoted;
      const d = {
        type: type.value,
        quantity: qty,
        unitPrice: price,
        quoted,
        nkd: isBond ? perBond : null,
        fee: U.parseNumber(fee.value) || 0,
        lotSize,
        isBond,
        face: target?.faceValue || 0,
      };
      return { ...d, amount: C.tradeAmount(d) };
    };

    // Итог пересчитывается на каждом нажатии клавиши: у брокера человек
    // привык видеть сумму до того, как подтвердит заявку.
    const totalValue = h('span', { class: 'total-value' });
    const totalNote = h('span', { class: 'total-note' });
    // Последствия продажи — там же, до нажатия «Сохранить». Узнать, что
    // подарил государству тринадцать процентов, потому что продал за месяц
    // до трёхлетия, положено заранее, а не в отчёте за год.
    const outcome = h('p', { class: 'callout callout-warn', hidden: true });
    const rowLots = U.field('Количество, лотов', lots);
    const priceLabel = h('span', { class: 'field-label' });
    const rowPrice = h('label', { class: 'field' }, [priceLabel, unitPrice]);
    const rowNkd = U.field('НКД на бумагу, ₽', nkd, 'Накопленный купон, который платится сверх цены. Как в отчёте брокера.');
    const rowFee = U.field('Комиссия, ₽', fee, 'Как в отчёте брокера. Покупку удорожает, из выручки вычитается.');
    const rowGross = U.field('Начислено, ₽', gross, 'Сумма до удержания налога — как в отчёте брокера.');
    const rowTax = U.field('Удержан налог, ₽', tax, 'Брокер удерживает его сам. В лимит по вкладам этот налог не входит.');

    const recount = () => {
      const d = draft();
      const isTrade = trade();
      const bond = isTrade && d.isBond;
      for (const [node, on] of [[rowLots, isTrade], [rowPrice, isTrade], [rowNkd, bond], [rowFee, isTrade],
        [rowGross, !isTrade], [rowTax, !isTrade]]) node.hidden = !on;
      priceLabel.textContent = bond ? 'Цена, % от номинала' : 'Цена за штуку, ₽';

      showOutcome(d, isTrade);
      totalValue.textContent = F.money2(d.amount);
      totalNote.textContent = isTrade
        ? [
            bond
              ? `${F.num(d.quantity, 0)} шт × ${F.num(d.quoted, 3)}% от ${F.money(d.face)}`
              : `${F.num(d.quantity, 0)} шт × ${F.num(d.unitPrice, 4)} ₽`,
            bond && d.nkd ? `НКД ${F.money2(d.nkd)}` : null,
            d.fee ? `комиссия ${F.money2(d.fee)}` : null,
            d.lotSize > 1 ? `в лоте ${F.num(d.lotSize, 0)}` : null,
          ].filter(Boolean).join(' · ')
        : d.tax
          ? `начислено ${F.money2(d.gross)}, налог ${F.money2(d.tax)}`
          : 'налог не удерживался';
    };
    /** Что случится с налогом, если продать столько по такой цене. */
    const showOutcome = (d, isTrade) => {
      const target = assetOf(asset.value);
      if (!isTrade || d.type !== C.OP_SELL || !target || !d.quantity || !d.unitPrice) {
        outcome.hidden = true;
        return;
      }
      const rate = C.taxRow(state.tax, state.operations, state.keyRate, D.today(), state.settings).ndflRate || 13;
      const others = state.operations.filter((x) => x.id !== op.id);
      const r = C.saleOutcome(target, others, d.quantity, d.unitPrice, date.value || D.today(), rate);

      const parts = [];
      if (r.profit > 0) {
        parts.push(r.tax > 0
          ? `Прибыль ${F.money(r.profit)}, налог ${F.money(r.tax)}.`
          : `Прибыль ${F.money(r.profit)}, налога нет — льгота за долгое владение.`);
      } else if (r.profit < 0) {
        parts.push(`Убыток ${F.money(Math.abs(r.profit))} — налога не будет.`);
      }
      if (r.exempt > 0 && r.tax > 0) parts.push(`Льготой закрыто ${F.money(r.exempt)}.`);

      // Главное предупреждение: гасится лот, которому до льготы рукой подать.
      const waiting = r.lots
        .filter((lot) => !lot.unknown)
        .map((lot) => ({ lot, st: C.ldvStatus(lot, date.value || D.today()) }))
        .filter((x) => x.st.known && !x.st.eligible && x.st.daysLeft > 0)
        .sort((a, b) => a.st.daysLeft - b.st.daysLeft)[0];
      if (waiting) {
        parts.push(`Затрагивается лот от ${F.date(waiting.lot.date)} — до льготы ${F.days(waiting.st.daysLeft)}.`);
      }
      if (r.unknownQty) parts.push(`${F.num(r.unknownQty, 0)} шт из начального блока — прибыль по ним неизвестна.`);

      outcome.textContent = parts.join(' ');
      outcome.hidden = parts.length === 0;
    };

    for (const node of [lots, unitPrice, nkd, fee, gross, tax]) node.addEventListener('input', recount);
    date.addEventListener('change', recount);
    for (const node of [type, asset]) {
      node.addEventListener('change', () => {
        if (node === asset && isNew) unitPrice.value = String(assetOf(asset.value)?.price ?? '').replace('.', ',');
        if (node === asset && isNew) nkd.value = '';
        recount();
      });
    }
    recount();

    api.setFooter([
      !isNew
        ? U.button('Удалить', () => {
            // Вид операции берём через строку: у записи из чужой копии его
            // может не быть, а удалять её всё равно надо.
            U.confirmSheet(`Удалить: ${String(op.type || 'операцию').toLowerCase()}?`,
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
          // Котировка сохраняется рядом с рублёвой ценой: по ней форма
          // откроется обратно такой же, какой её заполняли.
          quoted: trade() && d.isBond ? d.quoted : null,
          nkd: trade() && d.isBond ? d.nkd || null : null,
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
        // Покупка и полученный купон — такие же поводы, как взнос. Зверёк,
        // радующийся одному виду операций из шести, выглядит недоделанным.
        if (d.type !== C.OP_SELL) mascot.celebrate();
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
      rowNkd,
      rowFee,
      rowGross,
      rowTax,
      h('div', { class: 'total' }, [
        h('span', { class: 'total-label', text: 'Итого' }),
        totalValue,
        totalNote,
      ]),
      outcome,
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
    faceValue: null,
    couponRate: null,
    couponsPerYear: 2,
    nextCoupon: null,
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

    const faceValue = U.numberInput(a.faceValue);
    const couponRate = U.numberInput(a.couponRate);
    const couponsPerYear = U.select(
      [{ value: '1', label: 'раз в год' }, { value: '2', label: 'дважды в год' },
       { value: '4', label: 'ежеквартально' }, { value: '12', label: 'ежемесячно' }],
      String(a.couponsPerYear || 2),
    );
    const nextCoupon = U.input({ type: 'date', value: a.nextCoupon || '' });

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

    // Облигация ли это — решаем один раз: от ответа зависит и раскрытая
    // группа, и то, где окажется поле даты погашения.
    const bond = C.isBond(a) || (isNew && a.assetClass === 'Облигации');

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
          faceValue: U.parseNumber(faceValue.value),
          couponRate: U.parseNumber(couponRate.value),
          couponsPerYear: Number(couponsPerYear.value) || 2,
          nextCoupon: nextCoupon.value || null,
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
      U.field('Класс в портфеле', assetClass),

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

      // Раскрыта у облигации и у той, что ею собирается стать. Заполненный
      // номинал переключает толкование цены: биржа котирует облигацию
      // в процентах от номинала, а не в рублях.
      U.group('Облигация', bond, [
        U.field('Номинал, ₽', faceValue, 'Обычно 1000. Пока он не задан, цена читается как рубли за штуку, а не как проценты.'),
        U.field('Ставка купона, % годовых', couponRate),
        U.field('Периодичность', couponsPerYear),
        U.field('Ближайший купон', nextCoupon, 'Дату можно поставить один раз: дальше расчёт сам догоняет её до сегодняшнего дня.'),
        // Дата погашения одна на вклад и на облигацию, и узел поля тоже один:
        // положить его в обе группы нельзя — он просто переедет в последнюю.
        // Поэтому он стоит там, где его будут искать: у облигации здесь,
        // у вклада — среди процентов.
        bond ? U.field('Погашение', maturityDate) : null,
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
        bond ? null : U.field('Дата погашения', maturityDate),
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
