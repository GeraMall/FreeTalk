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

const cityNames: Record<number, string> = {
  1: 'Владивосток',
  3: 'Хабаровск',
  6: 'Томск',
  8: 'Омск',
  9: 'Новосибирск',
  11: 'Пермь',
  13: 'Уфа',
  14: 'Екатеринбург',
  16: 'Казань',
  18: 'Самара',
  19: 'Нижний Новгород',
  21: 'Воронеж',
  23: 'Волгоград',
  24: 'Ростов-на-Дону',
  26: 'Краснодар',
  27: 'Сочи',
  29: 'Севастополь',
  31: 'Калининград',
  32: 'Санкт-Петербург',
  34: 'Москва',
  37: 'Тверская',
  39: 'Арбат',
};
export const propertyBoard = originalBoard.map(
  ([name, price, group], i) => [cityNames[i] ?? name, price, group] as const,
);
export function propertyLog(text: string | undefined) {
  let result = text ?? '';
  for (const [i, name] of Object.entries(cityNames))
    result = result.replaceAll(originalBoard[Number(i)]![0], name);
  return result;
}
