import { comparePoker, evaluatePoker } from '@freetalk/protocol';

export const pokerHandNames = [
  'Старшая карта',
  'Пара',
  'Две пары',
  'Тройка',
  'Стрит',
  'Флеш',
  'Фулл-хаус',
  'Каре',
  'Стрит-флеш',
  'Флеш-рояль',
] as const;
export function pokerHand(cards: string[]) {
  if (!cards.length) return { name: '', cards: [] as string[], draw: '' };
  let best: string[] = [],
    rank: number[] = [];
  if (cards.length >= 5) {
    for (let a = 0; a < cards.length - 4; a++)
      for (let b = a + 1; b < cards.length - 3; b++)
        for (let c = b + 1; c < cards.length - 2; c++)
          for (let d = c + 1; d < cards.length - 1; d++)
            for (let e = d + 1; e < cards.length; e++) {
              const hand = [cards[a]!, cards[b]!, cards[c]!, cards[d]!, cards[e]!],
                score = evaluatePoker(hand);
              if (comparePoker(score, rank) > 0) {
                rank = score;
                best = hand;
              }
            }
  } else {
    const sorted = [...cards].sort(
      (a, b) => '23456789TJQKA'.indexOf(b[0]!) - '23456789TJQKA'.indexOf(a[0]!),
    );
    const pair = sorted.filter((c) => sorted.filter((x) => x[0] === c[0]).length >= 2);
    best = pair.length ? pair : [sorted[0]!];
    rank = [pair.length ? 1 : 0];
  }
  const category = rank[0] ?? 0;
  const highlighted = best.filter((c) => {
    const count = best.filter((x) => x[0] === c[0]).length;
    return category === 0
      ? c ===
          best.reduce((a, b) =>
            '23456789TJQKA'.indexOf(a[0]!) > '23456789TJQKA'.indexOf(b[0]!) ? a : b,
          )
      : [1, 2, 3, 7].includes(category)
        ? count >= ([3, 7].includes(category) ? (category === 7 ? 4 : 3) : 2)
        : true;
  });
  let draw = '';
  if (cards.length >= 5 && cards.length < 7 && category < 4) {
    if ([...'shdc'].some((s) => cards.filter((c) => c[1] === s).length === 4)) draw = 'Флеш-дро';
    const ranks = new Set(cards.map((c) => '23456789TJQKA'.indexOf(c[0]!) + 2));
    if (ranks.has(14)) ranks.add(1);
    if (
      Array.from({ length: 10 }, (_, i) => i + 1).some(
        (start) =>
          Array.from({ length: 5 }, (_, i) => start + i).filter((r) => ranks.has(r)).length === 4,
      )
    )
      draw = draw ? `${draw} · Стрит-дро` : 'Стрит-дро';
  }
  return {
    name: pokerHandNames[category === 8 && rank[1] === 14 ? 9 : category]!,
    cards: highlighted,
    draw,
  };
}
