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
