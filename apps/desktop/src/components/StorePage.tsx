import { useState } from 'react';
import { Gamepad2, LockKeyhole, Palette, Search } from 'lucide-react';
import { t } from '../lib/app-language';
import './store-page.css';

const games = [
  { name: 'Orbit Drift', detail: 'Гонки', art: 'orbit' },
  { name: 'Northline', detail: 'Стратегия', art: 'north' },
  { name: 'Signal Lost', detail: 'Приключение', art: 'signal' },
];

const styles = [
  { name: 'Морозное кольцо', detail: 'Рамка аватара', art: 'frame' },
  { name: 'Северный свет', detail: 'Карточка профиля', art: 'banner' },
  { name: 'Полночь', detail: 'Тема интерфейса', art: 'theme' },
];

export function StoreLocked() {
  return (
    <section className="store-page">
      <header className="store-heading">
        <h1>{t('Магазин')}</h1>
      </header>
      <p className="store-locked">
        <LockKeyhole size={18} aria-hidden="true" /> {t('Магазин пока закрыт')}
      </p>
    </section>
  );
}

export function StorePage() {
  const [section, setSection] = useState<'games' | 'appearance'>('games');
  const [query, setQuery] = useState('');
  const isGames = section === 'games';
  const search = query.trim().toLocaleLowerCase();
  const products = (isGames ? games : styles).filter(({ name, detail }) =>
    `${t(name)} ${t(detail)}`.toLocaleLowerCase().includes(search),
  );
  const searchLabel = t(isGames ? 'Поиск игр' : 'Поиск оформления');

  return (
    <section className="store-page" aria-labelledby="store-title">
      <header className="store-heading">
        <h1 id="store-title">{t('Магазин')}</h1>
        <div className="store-section-switch" role="group" aria-label={t('Разделы магазина')}>
          <button
            type="button"
            aria-pressed={isGames}
            onClick={() => {
              if (isGames) return;
              setSection('games');
              setQuery('');
            }}
          >
            <Gamepad2 size={18} aria-hidden="true" /> {t('Игры')}
          </button>
          <button
            type="button"
            aria-pressed={!isGames}
            onClick={() => {
              if (!isGames) return;
              setSection('appearance');
              setQuery('');
            }}
          >
            <Palette size={18} aria-hidden="true" /> {t('Оформление')}
          </button>
        </div>
      </header>
      <section className={`store-hero ${isGames ? 'store-hero-games' : 'store-hero-appearance'}`}>
        <div>
          <span className="store-preview-label">{t('Предпросмотр')}</span>
          <h2>{t(isGames ? 'Магазин игр' : 'Оформление TRLKA')}</h2>
          <p>
            {t(
              isGames
                ? 'Каталог игровых ключей и дополнений.'
                : 'Темы, рамки аватаров и карточки профиля.',
            )}
          </p>
        </div>
      </section>
      <section aria-labelledby="store-catalog-title" className="store-catalog">
        <div className="store-catalog-heading">
          <div>
            <h2 id="store-catalog-title">{t('Пример каталога')}</h2>
            <p>{t('Покупки появятся позже.')}</p>
          </div>
          <label className="store-search">
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              aria-label={searchLabel}
              placeholder={searchLabel}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>
        {products.length ? (
          <ul className="store-grid">
            {products.map(({ name, detail, art }) => (
              <li className="store-card" key={name}>
                <div className={`store-card-art store-art-${art}`} aria-hidden="true">
                  {isGames ? <span>{name}</span> : <i />}
                </div>
                <div className="store-card-info">
                  <h3>{t(name)}</h3>
                  <p>{t(detail)}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="store-empty" role="status">
            {t('Ничего не найдено')}
          </p>
        )}
      </section>
    </section>
  );
}
