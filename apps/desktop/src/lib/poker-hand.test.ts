import { describe, expect, it } from 'vitest';
import { pokerHand } from './poker-hand';
describe('private poker combination hints', () => {
  it('highlights only the two matching ranks for a pair and the highest card otherwise', () => {
    expect(pokerHand(['As', 'Ah']).cards).toEqual(['As', 'Ah']);
    expect(pokerHand(['As', 'Kh']).cards).toEqual(['As']);
  });
  it('recognizes a royal flush and wheel straight using five of seven cards', () => {
    const royal = pokerHand(['As', 'Ks', 'Qs', 'Js', 'Ts', '2h', '3c']);
    expect(royal.name).toBe('Флеш-рояль');
    expect(royal.cards).toHaveLength(5);
    expect(pokerHand(['As', '2d', '3c', '4h', '5h', 'Kh', 'Qh']).name).toBe('Стрит');
  });
  it('labels a draw without implying a completed flush or leaking unseen cards', () => {
    const draw = pokerHand(['Ah', '9h', 'Kh', '2h', '3c']);
    expect(draw.name).toBe('Старшая карта');
    expect(draw.draw).toContain('Флеш-дро');
  });
});
