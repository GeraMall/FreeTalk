import { quizPrizes, type TableOf } from '@freetalk/protocol';
import { useEffect, useState } from 'react';
import { Users, Phone, Scissors, Trophy } from 'lucide-react';
import { t } from '../lib/app-language';
import { playerName, type TableUiProps } from './activity-table-ui';
export function ActivityMillionaire({
  table,
  selfId,
  participants,
  send,
}: TableUiProps<TableOf<'millionaire'>>) {
  const [now, setNow] = useState(Date.now),
    [selected, setSelected] = useState<number>();
  useEffect(() => {
    setSelected(undefined);
  }, [table.level, table.id]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  const player = table.seats[0] === selfId,
    finished = table.phase === 'finished',
    answered = table.selected !== undefined;
  return (
    <div className="quiz-layout">
      <section className="quiz-stage" data-activity-surface="quiz">
        <div className="quiz-player">
          <Trophy size={22} />
          <div>
            <small>{t('В кресле игрока')}</small>
            <strong>{playerName(table.seats[0], participants)}</strong>
          </div>
          <b>{table.earned.toLocaleString()} ¤</b>
        </div>
        <div className="quiz-lifelines">
          {(
            [
              ['half', Scissors, '50:50'],
              ['audience', Users, 'Помощь зала'],
              ['friend', Phone, 'Звонок другу'],
            ] as const
          ).map(([help, Icon, label]) => (
            <button
              type="button"
              key={help}
              disabled={!player || finished || answered || table.lifelines.includes(help)}
              onClick={() => send({ kind: 'quiz-help', help })}
            >
              <Icon size={18} />
              <span>{t(label)}</span>
              {table.lifelines.includes(help) && <small>✓</small>}
            </button>
          ))}
        </div>
        {table.helpUntil && table.helpUntil > now && (
          <p className="quiz-help-banner">
            {t('Обсудите ответ с другом в звонке')} · {Math.ceil((table.helpUntil - now) / 1000)} с
          </p>
        )}
        <div className="quiz-question">
          <small>
            {t('Вопрос')} {table.level + 1} / 15 · {quizPrizes[table.level + 1]!.toLocaleString()} ¤
          </small>
          <h3>{table.question}</h3>
        </div>
        <div className="quiz-answers">
          {table.answers.map((answer, i) => (
            <button
              type="button"
              key={i}
              className={`${selected === i ? 'is-selected' : ''} ${answered && table.correct === i ? 'is-correct' : ''} ${answered && table.selected === i && table.correct !== i ? 'is-wrong' : ''}`}
              disabled={!player || answered || finished || table.eliminated.includes(i)}
              onClick={() => setSelected(i)}
            >
              <b>{'ABCD'[i]}:</b>
              <span>{table.eliminated.includes(i) ? '—' : answer}</span>
              {table.audience && <small>{table.audience[i]}%</small>}
            </button>
          ))}
        </div>
        {!player && table.audience && !answered && !finished && (
          <div className="quiz-audience">
            <p>{t('Помощь зала: выберите свой ответ')}</p>
            {table.answers.map((_, answer) => (
              <button
                type="button"
                key={answer}
                onClick={() => send({ kind: 'quiz-vote', answer })}
              >
                {'ABCD'[answer]}
              </button>
            ))}
          </div>
        )}
        <div className="quiz-actions">
          {finished ? (
            <div className="quiz-result">
              <Trophy size={25} />
              <strong>{table.winner === 'lost' ? t('Игра окончена') : t('Отличная игра!')}</strong>
              <span>
                {t('Ваш выигрыш')}: {table.earned.toLocaleString()} ¤
              </span>
              {selfId === table.hostId && (
                <button
                  type="button"
                  className="table-primary"
                  onClick={() => send({ kind: 'table-reset' })}
                >
                  {t('Сыграть ещё')}
                </button>
              )}
            </div>
          ) : player ? (
            answered ? (
              <button
                type="button"
                className="table-primary"
                onClick={() => send({ kind: 'quiz-next' })}
              >
                {t('Следующий вопрос')}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="table-primary"
                  disabled={selected === undefined}
                  onClick={() =>
                    selected !== undefined && send({ kind: 'quiz-answer', answer: selected })
                  }
                >
                  {t('Это окончательный ответ')}
                </button>
                <button type="button" onClick={() => send({ kind: 'quiz-stop' })}>
                  {t('Забрать выигрыш')}
                </button>
              </>
            )
          ) : (
            <p className="table-muted">{t('Вы наблюдаете. Поддержите игрока в звонке.')}</p>
          )}
        </div>
      </section>
      <aside className="quiz-ladder">
        <div className="table-section-label">{t('Лестница выигрыша')}</div>
        {quizPrizes
          .slice(1)
          .map((amount, index) => (
            <div
              key={amount}
              className={`${index === table.level ? 'current' : ''} ${[4, 9, 14].includes(index) ? 'guarantee' : ''}`}
            >
              <small>{index + 1}</small>
              <span>{amount.toLocaleString()} ¤</span>
            </div>
          ))
          .reverse()}
        <p className="table-muted">
          {t('Несгораемая сумма')}: {table.guaranteed.toLocaleString()} ¤
        </p>
      </aside>
    </div>
  );
}
