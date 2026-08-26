import mascot from '../assets/freetalk-mascot.png';

function BrandEmblem() {
  return (
    <span className="brand-emblem" aria-hidden="true">
      <img src={mascot} alt="" draggable={false} />
    </span>
  );
}

function BrandWordmark() {
  return (
    <span className="brand-wordmark" aria-hidden="true">
      FreeTalk
    </span>
  );
}

export function BrandLogo({ variant = 'full' }: { variant?: 'full' | 'compact' }) {
  return (
    <span className={`brand-logo brand-logo-${variant}`} role="img" aria-label="FreeTalk">
      <BrandEmblem />
      <BrandWordmark />
    </span>
  );
}
