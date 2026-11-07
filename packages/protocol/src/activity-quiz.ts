import type { TableOf, TableAction } from './activity-table.js';
import {
  randomInt,
  shuffled,
  type QuizQuestion,
  type TableSession,
  type TableContext,
} from './activity-table-internal.js';
export const quizPrizes = [
  0, 100, 200, 300, 500, 1000, 2000, 4000, 8000, 16000, 32000, 64000, 125000, 250000, 500000,
  1000000,
];
const facts: [string, string, string, string, string, string, string, string, string, string][] = [
  [
    'Сколько сторон у треугольника?',
    'Три',
    'Четыре',
    'Пять',
    'Шесть',
    'How many sides does a triangle have?',
    'Three',
    'Four',
    'Five',
    'Six',
  ],
  [
    'Какая фигура ходит в шахматах буквой «Г»?',
    'Конь',
    'Ладья',
    'Слон',
    'Король',
    'Which chess piece moves in an L shape?',
    'Knight',
    'Rook',
    'Bishop',
    'King',
  ],
  [
    'Какую планету называют Красной?',
    'Марс',
    'Венеру',
    'Сатурн',
    'Меркурий',
    'Which planet is called the Red Planet?',
    'Mars',
    'Venus',
    'Saturn',
    'Mercury',
  ],
  [
    'Сколько бит в одном байте?',
    '8',
    '4',
    '16',
    '32',
    'How many bits are in a byte?',
    '8',
    '4',
    '16',
    '32',
  ],
  [
    'Какой океан самый большой?',
    'Тихий',
    'Атлантический',
    'Индийский',
    'Северный Ледовитый',
    'Which ocean is the largest?',
    'Pacific',
    'Atlantic',
    'Indian',
    'Arctic',
  ],
  [
    'Какой химический символ у золота?',
    'Au',
    'Ag',
    'Fe',
    'Cu',
    'What is the chemical symbol for gold?',
    'Au',
    'Ag',
    'Fe',
    'Cu',
  ],
  [
    'Как называется расстояние, которое свет проходит за год?',
    'Световой год',
    'Парсек',
    'Астрономическая единица',
    'Световая секунда',
    'What is the distance light travels in a year called?',
    'Light-year',
    'Parsec',
    'Astronomical unit',
    'Light-second',
  ],
  [
    'Какое из чисел простое?',
    '29',
    '21',
    '27',
    '33',
    'Which number is prime?',
    '29',
    '21',
    '27',
    '33',
  ],
  [
    'Сколько рёбер у куба?',
    '12',
    '8',
    '6',
    '16',
    'How many edges does a cube have?',
    '12',
    '8',
    '6',
    '16',
  ],
  [
    'Какое число в двоичной системе записывается как 1010?',
    '10',
    '8',
    '12',
    '14',
    'What is binary 1010 in decimal?',
    '10',
    '8',
    '12',
    '14',
  ],
  [
    'Как называется переход вещества из твёрдого состояния сразу в газ?',
    'Сублимация',
    'Конденсация',
    'Кристаллизация',
    'Плавление',
    'What is the direct transition from solid to gas called?',
    'Sublimation',
    'Condensation',
    'Crystallization',
    'Melting',
  ],
  [
    'Какой из этих языков не является языком программирования?',
    'HTML',
    'Python',
    'Rust',
    'Java',
    'Which is a markup language rather than a programming language?',
    'HTML',
    'Python',
    'Rust',
    'Java',
  ],
  [
    'Сколько различных перестановок у трёх разных предметов?',
    '6',
    '3',
    '9',
    '12',
    'How many permutations are there of three distinct objects?',
    '6',
    '3',
    '9',
    '12',
  ],
  [
    'Чему равна сумма внутренних углов пятиугольника?',
    '540°',
    '360°',
    '450°',
    '720°',
    'What is the sum of a pentagon’s interior angles?',
    '540°',
    '360°',
    '450°',
    '720°',
  ],
  [
    'Чему равен определитель матрицы [[2, 3], [4, 5]]?',
    '−2',
    '2',
    '10',
    '−10',
    'What is the determinant of [[2, 3], [4, 5]]?',
    '−2',
    '2',
    '10',
    '−10',
  ],
];
export function makeQuiz(language: string): QuizQuestion[] {
  return facts.map((fact, difficulty) => {
    let q: string, a: string[];
    // Alternate each tier with a fresh arithmetic question. No remote service is required.
    if (randomInt(2)) {
      const x = 3 + randomInt(12) + difficulty,
        y = 2 + randomInt(8),
        answer = x * y;
      q = language === 'en' ? `What is ${x} × ${y}?` : `Чему равно ${x} × ${y}?`;
      a = [String(answer), String(answer + y), String(answer - y), String(answer + x)];
    } else {
      const offset = language === 'en' ? 5 : 0;
      q = fact[offset]!;
      a = fact.slice(offset + 1, offset + 5);
    }
    const order = shuffled([0, 1, 2, 3]);
    return {
      q,
      a: order.map((i) => a[i]!) as QuizQuestion['a'],
      correct: order.indexOf(0),
      difficulty,
    };
  });
}
export function quizQuestion(
  v: TableOf<'millionaire'>,
  questions: QuizQuestion[],
): TableOf<'millionaire'> {
  const q = questions[v.level]!;
  return {
    ...v,
    question: q.q,
    answers: q.a,
    selected: undefined,
    correct: undefined,
    eliminated: [],
    audience: undefined,
    helpUntil: undefined,
  };
}
export function reduceQuiz(
  session: TableSession,
  action: TableAction,
  context: TableContext,
): TableSession {
  if (session.view.kind !== 'millionaire' || session.view.phase !== 'playing') return session;
  const v = structuredClone(session.view),
    q = session.secret.quiz?.[v.level];
  if (!q) return session;
  const player = v.seats[0];
  if (action.kind === 'quiz-vote') {
    if (player === context.actorId || !v.audience || v.selected !== undefined) return session;
    const votes = { ...session.secret.votes, [context.actorId]: action.answer };
    const total = Object.values(votes);
    v.audience = [0, 1, 2, 3].map((i) =>
      Math.round((total.filter((n) => n === i).length / total.length) * 100),
    );
    return { view: v, secret: { ...session.secret, votes } };
  }
  if (player !== context.actorId) return session;
  if (
    action.kind === 'quiz-answer' &&
    v.selected === undefined &&
    !v.eliminated.includes(action.answer)
  ) {
    v.selected = action.answer;
    v.correct = q.correct;
    if (action.answer !== q.correct) {
      v.phase = 'finished';
      v.earned = v.guaranteed;
      v.winner = 'lost';
    } else {
      v.earned = quizPrizes[v.level + 1]!;
      if ([4, 9, 14].includes(v.level)) v.guaranteed = v.earned;
      if (v.level === 14) {
        v.phase = 'finished';
        v.winner = player ?? 'won';
      }
    }
  } else if (action.kind === 'quiz-next' && v.selected === q.correct && v.level < 14) {
    return {
      view: quizQuestion({ ...v, level: v.level + 1 }, session.secret.quiz!),
      secret: { ...session.secret, votes: {} },
    };
  } else if (action.kind === 'quiz-stop' && v.selected === undefined) {
    v.phase = 'finished';
    v.winner = 'cashout';
  } else if (
    action.kind === 'quiz-help' &&
    v.selected === undefined &&
    !v.lifelines.includes(action.help)
  ) {
    v.lifelines.push(action.help);
    if (action.help === 'half')
      v.eliminated = shuffled([0, 1, 2, 3].filter((i) => i !== q.correct)).slice(0, 2);
    if (action.help === 'friend') v.helpUntil = context.now + 60000;
    if (action.help === 'audience') v.audience = [0, 0, 0, 0];
  } else return session;
  return { ...session, view: v };
}
