import { appLanguage, type AppLanguage } from '../lib/app-language';

const ribbonPalettes = {
  ru: ['#d9e3f2', '#6293ec', '#dc6476'],
  en: ['#7899e1', '#dce5f4', '#d76880'],
  'zh-CN': ['#d65c70', '#e0b868', '#d65c70'],
  kk: ['#57bfd9', '#e0c269', '#57bfd9'],
  be: ['#d2737e', '#dbe4e9', '#66b092'],
  ka: ['#dbe4ee', '#d66d7e', '#dbe4ee'],
  es: ['#d76c78', '#e0b365', '#d76c78'],
} satisfies Record<AppLanguage, readonly [string, string, string]>;

const ribbonArcs = [
  { side: 'upper', path: 'M-260 650 Q470 -30 1860 -230', offset: 1 },
  { side: 'lower', path: 'M-260 1220 Q1110 950 1860 270', offset: -1 },
] as const;

const stars = Array.from({ length: 58 }, (_, index) => {
  const size = index % 13 === 0 ? 2 : index % 4 === 0 ? 1.4 : 1;
  return {
    left: ((index * 377 + 33) % 997) / 10 + '%',
    top: ((index * index * 37 + 29 * index + 93) % 983) / 10 + '%',
    width: size,
    height: size,
    animationDuration: 10 + (index % 11) + 's',
    animationDelay: -(index % 13) + 's',
  };
});

export function AuroraBackground() {
  const language = appLanguage();
  return (
    <div className="aurora" data-language={language} aria-hidden="true">
      <svg className="aurora-ribbon" viewBox="0 0 1600 1080" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="auth-ribbon-fill" x1="0" y1="0" x2="0.8" y2="1">
            <stop stopColor="#101b2e" />
            <stop offset=".55" stopColor="#0b121f" />
            <stop offset="1" stopColor="#1b2d46" />
          </linearGradient>
          <linearGradient id="auth-ribbon-wave">
            <stop stopColor="white" stopOpacity="0" />
            <stop offset=".22" stopColor="white" stopOpacity=".22" />
            <stop offset=".5" stopColor="white" />
            <stop offset=".78" stopColor="white" stopOpacity=".22" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
          </linearGradient>
          {[0, 1, 2].map((index) => (
            <mask
              key={index}
              id={'auth-ribbon-mask-' + index}
              maskUnits="userSpaceOnUse"
              x="-300"
              y="-300"
              width="2200"
              height="1600"
            >
              <rect
                className="aurora-wave"
                x="-880"
                y="-300"
                width="620"
                height="1600"
                fill="url(#auth-ribbon-wave)"
                style={{ animationDelay: -(8 - index * 0.8) + 's' }}
              />
            </mask>
          ))}
        </defs>
        <g className="aurora-ribbon-body">
          <path
            d="M-260 650 Q470 -30 1860 -230 L1860 270 Q1110 950 -260 1220 Z"
            fill="url(#auth-ribbon-fill)"
          />
          {ribbonArcs.map(({ side, path, offset }) => (
            <g key={side} className={'aurora-stripes aurora-stripes-' + side}>
              {ribbonPalettes[language].map((color, index) => (
                <g key={index} color={color} transform={'translate(0 ' + index * offset * 13 + ')'}>
                  <path className="aurora-stripe" d={path} />
                  <path
                    className="aurora-shimmer"
                    d={path}
                    mask={`url(#auth-ribbon-mask-${index})`}
                  />
                </g>
              ))}
            </g>
          ))}
        </g>
      </svg>
      <div className="auth-sky">
        {stars.map((style, index) => (
          <span
            className="auth-star"
            data-twinkle={index % 11 === 0 ? 'bright' : index % 3 === 0 ? 'steady' : 'soft'}
            key={style.left}
            style={style}
          />
        ))}
        <span className="auth-meteor" />
      </div>
    </div>
  );
}
