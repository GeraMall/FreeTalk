import { propertyBoard as originalBoard } from '@freetalk/protocol';
import { Rocket, Car, Ship, Crown, TrainFront, Cat } from 'lucide-react';
export const propertyColors = [
  '#94674d',
  '#8ecbdf',
  '#bc6c9d',
  '#de9a50',
  '#cc5b64',
  '#dbc76d',
  '#69a77c',
  '#628ccc',
  '#a0adba',
  '#a0adba',
];
export const playerColors = ['#8ab7e1', '#d69b78', '#98bf90', '#c3a2d7', '#e1ca7b', '#74c2bf'];
export const tokenIcons = [Rocket, Car, Ship, Crown, TrainFront, Cat];
export function propertyPosition(i: number) {
  return i <= 10
    ? { row: 10, col: 10 - i }
    : i <= 20
      ? { row: 20 - i, col: 0 }
      : i <= 30
        ? { row: 0, col: i - 20 }
        : { row: i - 30, col: 10 };
}

const streetNames: Record<number, string> = {
  1: 'Житная улица',
  3: 'Нагатинская улица',
  6: 'Варшавское шоссе',
  8: 'Газетный переулок',
  9: 'Первая Парковая улица',
  11: 'Улица Полянка',
  13: 'Улица Сретенка',
  14: 'Ростовская набережная',
  16: 'Рязанский проспект',
  18: 'Улица Вавилова',
  19: 'Рублёвское шоссе',
  21: 'Улица Покровка',
  23: 'Мясницкая улица',
  24: 'Пятницкая улица',
  26: 'Улица Грузинский Вал',
  27: 'Смоленская площадь',
  29: 'Садовая-Кудринская улица',
  31: 'Гоголевский бульвар',
  32: 'Кутузовский проспект',
  34: 'Ленинградский проспект',
  37: 'Тверская улица',
  39: 'Арбат',
};
export const propertyBoardLabels: Record<number, string> = {
  1: 'Житная',
  3: 'Нага\u00adтинская',
  6: 'Варшав\u00adское',
  8: 'Газетный',
  9: '1-я Парко\u00adвая',
  11: 'Полянка',
  13: 'Сре\u00adтенка',
  14: 'Ростов\u00adская',
  16: 'Рязан\u00adский',
  18: 'Вави\u00adлова',
  19: 'Рублёв\u00adское',
  21: 'Пок\u00adровка',
  23: 'Мяс\u00adницкая',
  24: 'Пят\u00adницкая',
  26: 'Грузинский Вал',
  27: 'Смо\u00adленская',
  29: 'Садовая-\u200bКудрин\u00adская',
  31: 'Гого\u00adлевский',
  32: 'Куту\u00adзовский',
  34: 'Ленин\u00adградский',
  37: 'Тверская',
  39: 'Арбат',
};
export const propertyBoard = originalBoard.map(
  ([name, price, group], i) => [streetNames[i] ?? name, price, group] as const,
);
export function propertyLog(text: string | undefined) {
  let result = text ?? '';
  for (const [i, name] of Object.entries(streetNames))
    result = result.replaceAll(originalBoard[Number(i)]![0], name);
  return result;
}
