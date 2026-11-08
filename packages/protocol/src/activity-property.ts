import type { TableOf, TableAction } from './activity-table.js';
import {
  addLog,
  randomInt,
  type TableSession,
  type TableContext,
} from './activity-table-internal.js';
export const propertyBoard = [
  ['Старт', 0, -1],
  ['Лунная', 60, 0],
  ['Событие', 0, -1],
  ['Орбитальная', 60, 0],
  ['Сбор', 200, -1],
  ['Северный вокзал', 200, 8],
  ['Кометная', 100, 1],
  ['Шанс', 0, -1],
  ['Метеорная', 100, 1],
  ['Звёздная', 120, 1],
  ['Тюрьма / В гостях', 0, -1],
  ['Венера', 140, 2],
  ['Энергостанция', 150, 9],
  ['Марс', 140, 2],
  ['Юпитер', 160, 2],
  ['Восточный вокзал', 200, 8],
  ['Атлас', 180, 3],
  ['Событие', 0, -1],
  ['Орион', 180, 3],
  ['Пегас', 200, 3],
  ['Стоянка', 0, -1],
  ['Андромеда', 220, 4],
  ['Шанс', 0, -1],
  ['Кассиопея', 220, 4],
  ['Лира', 240, 4],
  ['Южный вокзал', 200, 8],
  ['Сириус', 260, 5],
  ['Вега', 260, 5],
  ['Водостанция', 150, 9],
  ['Альтаир', 280, 5],
  ['В тюрьму', 0, -1],
  ['Нептун', 300, 6],
  ['Уран', 300, 6],
  ['Событие', 0, -1],
  ['Сатурн', 320, 6],
  ['Западный вокзал', 200, 8],
  ['Шанс', 0, -1],
  ['Млечный путь', 350, 7],
  ['Налог', 100, -1],
  ['Галактика', 400, 7],
] as const;
const baseRents: Record<number, number[]> = {
  60: [2, 10, 30, 90, 160, 250],
  100: [6, 30, 90, 270, 400, 550],
  120: [8, 40, 100, 300, 450, 600],
  140: [10, 50, 150, 450, 625, 750],
  160: [12, 60, 180, 500, 700, 900],
  180: [14, 70, 200, 550, 750, 950],
  200: [16, 80, 220, 600, 800, 1000],
  220: [18, 90, 250, 700, 875, 1050],
  240: [20, 100, 300, 750, 925, 1100],
  260: [22, 110, 330, 800, 975, 1150],
  280: [24, 120, 360, 850, 1025, 1200],
  300: [26, 130, 390, 900, 1100, 1275],
  320: [28, 150, 450, 1000, 1200, 1400],
  350: [35, 175, 500, 1100, 1300, 1500],
  400: [50, 200, 600, 1400, 1700, 2000],
};
export const propertyGroup = (index: number) =>
  propertyBoard.flatMap((p, i) => (p[2] === propertyBoard[index]?.[2] ? [i] : []));
export const housePrice = (index: number) => 50 * (Math.floor(propertyBoard[index]![2] / 2) + 1);
export function propertyRentSchedule(index: number): number[] {
  if (index === 3) return [4, 20, 60, 180, 320, 450];
  return [...(baseRents[propertyBoard[index]?.[1] ?? 0] ?? [])];
}
export function propertyBuildingStock(v: TableOf<'monopoly'>) {
  return {
    houses: 32 - v.houses.reduce((n, h) => n + (h < 5 ? h : 0), 0),
    hotels: 12 - v.houses.filter((h) => h === 5).length,
  };
}
export function propertyLiquidation(v: TableOf<'monopoly'>, seat: number) {
  return v.owners.reduce(
    (sum, owner, i) =>
      owner !== seat
        ? sum
        : sum +
          (v.mortgaged.includes(i) ? 0 : propertyBoard[i]![1] / 2) +
          (propertyBoard[i]![2] >= 0 && propertyBoard[i]![2] < 8
            ? (v.houses[i]! * housePrice(i)) / 2
            : 0),
    0,
  );
}
function finish(v: TableOf<'monopoly'>) {
  const alive = v.seats.flatMap((s, i) => (s && !v.bankrupt.includes(i) ? [i] : []));
  return alive.length === 1 ? { ...v, phase: 'finished' as const, winner: v.seats[alive[0]!]! } : v;
}
function transfer(v: TableOf<'monopoly'>, seat: number, amount: number, to = -1) {
  v.money[seat]! -= amount;
  if (to >= 0) v.money[to]! += amount;
  v.debtTo = to;
  if (v.money[seat]! < 0) v.step = 'debt';
}
function landing(v: TableOf<'monopoly'>, seat: number, now = 0) {
  const index = v.positions[seat]!,
    tile = propertyBoard[index]!;
  v.step = 'end';
  if (index === 30) {
    v.positions[seat] = 10;
    v.jail[seat] = 3;
    v.extraRoll = false;
    return addLog(v, `Игрок ${seat + 1} отправляется в тюрьму`);
  }
  if (index === 4 || index === 38) {
    transfer(v, seat, tile[1]);
    return addLog(v, `Сбор ${tile[1]}`);
  }
  if ([2, 7, 17, 22, 33, 36].includes(index)) {
    const event = randomInt(5);
    if (v.propertyRules === 2) {
      const descriptions = [
        ['Научная премия', 'Ваше исследование получило награду. Получите 150 ¤ из банка.'],
        ['Ремонт оборудования', 'Оплатите ремонт: 100 ¤ в банк.'],
        ['Возвращение домой', 'Переместитесь на старт и получите 200 ¤.'],
        [
          'Проверка документов',
          'Отправляйтесь в тюрьму. За прохождение старта выплата не положена.',
        ],
        [
          'Обслуживание недвижимости',
          'Оплатите 50 ¤, ещё по 25 ¤ за каждый дом и по 100 ¤ за каждый отель.',
        ],
      ];
      v.lastCard = {
        sequence: (v.lastCard?.sequence ?? 0) + 1,
        kind: [7, 22, 36].includes(index) ? 'chance' : 'event',
        title: descriptions[event]![0]!,
        text: descriptions[event]![1]!,
        at: now,
      };
    }
    if (event === 0) {
      v.money[seat]! += 150;
      return addLog(v, 'Премия за исследование: +150');
    }
    if (event === 1) {
      transfer(v, seat, 100);
      return addLog(v, 'Ремонт оборудования: −100');
    }
    if (event === 2) {
      v.positions[seat] = 0;
      v.money[seat]! += 200;
      return addLog(v, 'Возвращение на старт: +200');
    }
    if (event === 3) {
      v.positions[seat] = 10;
      v.jail[seat] = 3;
      v.extraRoll = false;
      return addLog(v, 'Проверка документов: пропустите рейс в тюрьме');
    }
    const repair = v.owners.reduce(
      (n, owner, i) =>
        n +
        (owner === seat
          ? v.propertyRules === 2 && v.houses[i] === 5
            ? 100
            : v.houses[i]! * 25
          : 0),
      50,
    );
    transfer(v, seat, repair);
    return addLog(v, `Обслуживание станций: −${repair}`);
  }
  if (!tile[1] || tile[2] < 0) return v;
  const owner = v.owners[index]!;
  if (owner < 0) {
    v.step = 'buy';
    return v;
  }
  if (owner === seat || v.mortgaged.includes(index)) return v;
  const group = propertyGroup(index),
    owned = group.filter((i) => v.owners[i] === owner).length;
  const rent =
    tile[2] === 8
      ? 25 * 2 ** (owned - 1)
      : tile[2] === 9
        ? (v.dice[0] + v.dice[1]) * (owned === 2 ? 10 : 4)
        : ((v.propertyRules === 2 ? propertyRentSchedule(index) : baseRents[tile[1]]!)[
            v.houses[index]!
          ] ?? 0) * (v.houses[index] === 0 && owned === group.length ? 2 : 1);
  transfer(v, seat, rent, owner);
  return addLog(v, `Игрок ${seat + 1} → игроку ${owner + 1}: аренда ${rent}`);
}
function reducePropertyLegacy(
  session: TableSession,
  action: TableAction,
  context: TableContext,
): TableSession {
  if (session.view.kind !== 'monopoly' || session.view.phase !== 'playing') return session;
  const old = session.view,
    seat = old.seats.indexOf(context.actorId);
  if (seat < 0 || old.bankrupt.includes(seat)) return session;
  let v = structuredClone(old);
  if (action.kind === 'property-trade') {
    if (
      v.trade ||
      v.auction ||
      v.step === 'debt' ||
      seat === action.to ||
      !v.seats[action.to] ||
      v.bankrupt.includes(action.to)
    )
      return session;
    if (
      new Set(action.give).size !== action.give.length ||
      new Set(action.want).size !== action.want.length
    )
      return session;
    if (
      !action.give.every((i) => v.owners[i] === seat && v.houses[i] === 0) ||
      !action.want.every((i) => v.owners[i] === action.to && v.houses[i] === 0)
    )
      return session;
    v.trade = {
      from: seat,
      to: action.to,
      give: action.give,
      want: action.want,
      cash: action.cash,
    };
    return { ...session, view: addLog(v, 'Предложен обмен собственностью') };
  }
  if (action.kind === 'property-trade-answer') {
    const t = v.trade;
    if (!t || t.to !== seat) return session;
    if (
      action.accept &&
      v.money[t.from]! >= Math.max(0, t.cash) &&
      v.money[t.to]! >= Math.max(0, -t.cash) &&
      t.give.every((i) => v.owners[i] === t.from && v.houses[i] === 0) &&
      t.want.every((i) => v.owners[i] === t.to && v.houses[i] === 0)
    ) {
      t.give.forEach((i) => (v.owners[i] = t.to));
      t.want.forEach((i) => (v.owners[i] = t.from));
      v.money[t.from]! -= t.cash;
      v.money[t.to]! += t.cash;
    }
    v.trade = undefined;
    return { ...session, view: addLog(v, action.accept ? 'Обмен завершён' : 'Обмен отклонён') };
  }
  if (action.kind !== 'property') return session;
  if (v.auction) {
    const a = v.auction;
    if (a.turn !== seat || !['bid', 'auction-pass'].includes(action.action)) return session;
    if (action.action === 'bid') {
      const bid = a.bid + 10;
      if (v.money[seat]! < bid) return session;
      a.bid = bid;
      a.bidder = seat;
    } else a.passed.push(seat);
    const eligible = v.seats.flatMap((s, i) =>
      s && !v.bankrupt.includes(i) && !a.passed.includes(i) && i !== a.bidder ? [i] : [],
    );
    if (!eligible.length) {
      if (a.bidder >= 0) {
        v.owners[a.index] = a.bidder;
        v.money[a.bidder]! -= a.bid;
      }
      v.auction = undefined;
      v.step = 'end';
    } else {
      for (let n = 1; n <= v.seats.length; n++) {
        const next = (seat + n) % v.seats.length;
        if (eligible.includes(next)) {
          a.turn = next;
          break;
        }
      }
    }
    return {
      ...session,
      view: addLog(v, action.action === 'bid' ? `Аукцион: ${a.bid}` : 'Игрок пропустил аукцион'),
    };
  }
  const index = action.index ?? -1;
  if (['build', 'sell-house', 'mortgage'].includes(action.action)) {
    if (v.owners[index] !== seat) return session;
    const tile = propertyBoard[index]!,
      group = propertyGroup(index);
    if (action.action === 'build') {
      const cost = housePrice(index);
      if (
        tile[2] < 0 ||
        tile[2] > 7 ||
        !group.every((i) => v.owners[i] === seat && !v.mortgaged.includes(i)) ||
        v.houses[index]! >= 5 ||
        v.houses[index] !== Math.min(...group.map((i) => v.houses[i]!)) ||
        v.money[seat]! < cost
      )
        return session;
      v.houses[index]!++;
      v.money[seat]! -= cost;
    } else if (action.action === 'sell-house') {
      if (!v.houses[index] || v.houses[index] !== Math.max(...group.map((i) => v.houses[i]!)))
        return session;
      v.houses[index]!--;
      v.money[seat]! += housePrice(index) / 2;
    } else {
      if (v.mortgaged.includes(index)) {
        const cost = Math.ceil(tile[1] * 0.55);
        if (v.money[seat]! < cost) return session;
        v.money[seat]! -= cost;
        v.mortgaged = v.mortgaged.filter((i) => i !== index);
      } else {
        if (group.some((i) => v.houses[i]! > 0)) return session;
        v.mortgaged.push(index);
        v.money[seat]! += tile[1] / 2;
      }
    }
    if (v.step === 'debt' && v.money[v.turn]! >= 0) v.step = 'end';
    return { ...session, view: addLog(v, `Игрок ${seat + 1}: ${action.action} · ${tile[0]}`) };
  }
  if (seat !== v.turn) return session;
  if (action.action === 'bankrupt') {
    v.bankrupt.push(seat);
    const creditor = v.step === 'debt' ? v.debtTo : -1;
    if (creditor >= 0) v.money[creditor]! += Math.min(0, v.money[seat]!);
    v.owners = v.owners.map((owner, i) => {
      if (owner !== seat) return owner;
      v.houses[i] = 0;
      return creditor;
    });
    v.money[seat] = 0;
    v = finish(v);
    if (v.phase !== 'finished') {
      do {
        v.turn = (v.turn + 1) % v.seats.length;
      } while (!v.seats[v.turn] || v.bankrupt.includes(v.turn));
      v.step = 'roll';
      v.extraRoll = false;
      v.doubles = 0;
    }
    return { ...session, view: addLog(v, `Игрок ${seat + 1} объявил банкротство`) };
  }
  if (
    action.action === 'jail-pay' &&
    v.step === 'roll' &&
    v.jail[seat]! > 0 &&
    v.money[seat]! >= 50
  ) {
    v.money[seat]! -= 50;
    v.jail[seat] = 0;
    return { ...session, view: addLog(v, 'Залог уплачен: 50') };
  }
  if (action.action === 'roll' && v.step === 'roll') {
    v.dice = [randomInt(6) + 1, randomInt(6) + 1];
    const double = v.dice[0] === v.dice[1];
    v.extraRoll = double;
    if (v.jail[seat]! > 0) {
      v.extraRoll = false;
      if (double) v.jail[seat] = 0;
      else {
        v.jail[seat]!--;
        if (v.jail[seat]) {
          v.step = 'end';
          return { ...session, view: addLog(v, 'Без дубля: ожидание в тюрьме') };
        }
        transfer(v, seat, 50);
        if (v.propertyRules === 2 && v.money[seat]! < 0) {
          v.pendingJailDice = v.dice;
          return { ...session, view: addLog(v, 'Для выхода из тюрьмы сначала погасите залог 50') };
        }
      }
    } else {
      v.doubles = double ? v.doubles + 1 : 0;
      if (v.doubles >= 3) {
        v.positions[seat] = 10;
        v.jail[seat] = 3;
        v.extraRoll = false;
        v.step = 'end';
        return { ...session, view: addLog(v, 'Три дубля подряд: в тюрьму') };
      }
    }
    const position = v.positions[seat]! + v.dice[0] + v.dice[1];
    if (position >= 40) v.money[seat]! += 200;
    v.positions[seat] = position % 40;
    const debt = v.money[seat]! < 0;
    v = landing(v, seat, context.now);
    if (debt) v.step = 'debt';
    return {
      ...session,
      view: addLog(
        v,
        `Игрок ${seat + 1}: ${v.dice.join(' + ')} → ${propertyBoard[v.positions[seat]!]![0]}`,
      ),
    };
  }
  if (action.action === 'buy' && v.step === 'buy') {
    const pos = v.positions[seat]!,
      price = propertyBoard[pos]![1];
    if (v.money[seat]! < price || v.owners[pos] !== -1) return session;
    v.money[seat]! -= price;
    v.owners[pos] = seat;
    v.step = 'end';
  } else if (action.action === 'pass' && v.step === 'buy') {
    v.auction = { index: v.positions[seat]!, bid: 0, bidder: -1, passed: [], turn: seat };
  } else if (action.action === 'end' && v.step === 'end') {
    if (v.extraRoll) {
      v.step = 'roll';
      v.extraRoll = false;
    } else {
      do {
        v.turn = (v.turn + 1) % v.seats.length;
      } while (!v.seats[v.turn] || v.bankrupt.includes(v.turn));
      v.step = 'roll';
      v.doubles = 0;
    }
    v.trade = undefined;
  } else return session;
  return { ...session, view: addLog(v, `Игрок ${seat + 1}: ${action.action}`) };
}

function eliminate(v: TableOf<'monopoly'>, seat: number, automatic: boolean) {
  const creditor = v.step === 'debt' ? v.debtTo : -1;
  // Buildings are sold to the bank; properties go to the creditor, never vanish.
  for (let i = 0; i < v.owners.length; i++)
    if (v.owners[i] === seat) {
      if (v.houses[i]) v.money[seat]! += (v.houses[i]! * housePrice(i)) / 2;
      v.houses[i] = 0;
      v.owners[i] = creditor;
      if (creditor < 0) v.mortgaged = v.mortgaged.filter((p) => p !== i);
    }
  if (creditor >= 0) v.money[creditor]! += v.money[seat]!;
  v.pendingJailDice = undefined;
  v.money[seat] = 0;
  if (!v.bankrupt.includes(seat)) v.bankrupt.push(seat);
  v.trade = undefined;
  v.auction = undefined;
  v.extraRoll = false;
  v.doubles = 0;
  v = finish(v);
  if (v.phase !== 'finished') {
    do {
      v.turn = (v.turn + 1) % v.seats.length;
    } while (!v.seats[v.turn] || v.bankrupt.includes(v.turn));
    v.step = 'roll';
  }
  return addLog(
    v,
    `Игрок ${seat + 1}: ${automatic ? 'долг превышает стоимость всех активов — банкротство' : 'банкротство'}`,
  );
}
function finishPropertyAction(
  session: TableSession,
  old: TableOf<'monopoly'>,
  v: TableOf<'monopoly'>,
  action: TableAction,
  context: TableContext,
): TableSession {
  let resumed = false;
  const waiting = Boolean(v.pendingJailDice),
    roller = old.turn;
  if (v.pendingJailDice && v.money[v.turn]! >= 0) {
    const steps = v.pendingJailDice[0] + v.pendingJailDice[1];
    v.pendingJailDice = undefined;
    const position = v.positions[v.turn]! + steps;
    if (position >= 40) v.money[v.turn]! += 200;
    v.positions[v.turn] = position % 40;
    v = landing(v, v.turn, context.now);
    resumed = true;
  }
  if (v.step === 'debt' && v.money[v.turn]! + propertyLiquidation(v, v.turn) < 0)
    v = eliminate(v, v.turn, true);
  const rolling = action.kind === 'property' && action.action === 'roll';
  if (rolling || resumed) {
    const from = old.positions[roller]!,
      steps = v.dice[0] + v.dice[1];
    let path: number[] = [];
    const jailStay =
      (waiting && !resumed) ||
      (old.jail[roller]! > 0 && v.positions[roller] === from && v.jail[roller]! > 0);
    if (!jailStay) {
      if (v.jail[roller]! > 0 && old.doubles >= 2) path = [10];
      else {
        path = Array.from({ length: steps }, (_, i) => (from + i + 1) % 40);
        if (path.at(-1) !== v.positions[roller]) path.push(v.positions[roller]!);
      }
    }
    v.lastMove = {
      sequence: (old.lastMove?.sequence ?? 0) + 1,
      motion: rolling ? context.diceMotion : undefined,
      rollMs: rolling ? (context.propertyRoll === 2 ? 2200 : 900) : undefined,
      roll: !resumed,
      seat: roller,
      from,
      path,
      at: context.now,
      until:
        context.now +
        (resumed ? 0 : context.propertyRoll === 2 ? 2200 : 900) +
        path.length * 110 +
        180,
    };
  }
  return { ...session, view: v };
}
export function reduceProperty(
  session: TableSession,
  action: TableAction,
  context: TableContext,
): TableSession {
  if (session.view.kind !== 'monopoly' || session.view.propertyRules !== 2)
    return reducePropertyLegacy(session, action, context);
  const old = session.view,
    seat = old.seats.indexOf(context.actorId);
  if (
    old.phase !== 'playing' ||
    seat < 0 ||
    old.bankrupt.includes(seat) ||
    context.now < (old.lastMove?.until ?? 0)
  )
    return session;
  if (action.kind === 'property' && action.action === 'bankrupt') {
    return seat === old.turn
      ? { ...session, view: eliminate(structuredClone(old), seat, false) }
      : session;
  }
  if (action.kind === 'property' && action.action === 'liquidate-group') {
    const index = action.index ?? -1,
      group = propertyGroup(index);
    if (
      propertyBoard[index]?.[2] === undefined ||
      propertyBoard[index]![2] < 0 ||
      propertyBoard[index]![2] > 7 ||
      !group.every((i) => old.owners[i] === seat) ||
      !group.some((i) => old.houses[i]! > 0)
    )
      return session;
    const v = structuredClone(old);
    for (const i of group) {
      v.money[seat]! += (v.houses[i]! * housePrice(i)) / 2;
      v.houses[i] = 0;
    }
    if (v.step === 'debt' && v.money[v.turn]! >= 0) v.step = 'end';
    return finishPropertyAction(
      session,
      old,
      addLog(v, `Игрок ${seat + 1}: проданы все постройки цветовой группы`),
      action,
      context,
    );
  }
  if (action.kind === 'property' && action.index !== undefined) {
    const stock = propertyBuildingStock(old),
      level = old.houses[action.index]!;
    if (action.action === 'build' && (level === 4 ? stock.hotels < 1 : stock.houses < 1))
      return session;
    if (action.action === 'sell-house' && level === 5 && stock.houses < 4) return session;
  }
  if (action.kind === 'property-trade') {
    if (
      ![...action.give, ...action.want].every((i) =>
        propertyGroup(i).every((j) => old.houses[j] === 0),
      )
    )
      return session;
  }
  if (
    action.kind === 'property-trade-answer' &&
    action.accept &&
    old.trade &&
    ![...old.trade.give, ...old.trade.want].every((i) =>
      propertyGroup(i).every((j) => old.houses[j] === 0),
    )
  ) {
    return reducePropertyLegacy(session, { kind: 'property-trade-answer', accept: false }, context);
  }
  const next = reducePropertyLegacy(session, action, context);
  if (next === session || next.view.kind !== 'monopoly') return next;
  return finishPropertyAction(next, old, next.view, action, context);
}
