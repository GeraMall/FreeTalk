export function PropertyArtwork({ index }: { index: number }) {
  const train = [5, 15, 25, 35].includes(index),
    water = index === 28,
    energy = index === 12,
    jail = index === 10 || index === 30,
    start = index === 0,
    parking = index === 20,
    tax = index === 4 || index === 38,
    chance = [7, 22, 36].includes(index),
    event = [2, 17, 33].includes(index);
  if (!train && !water && !energy && !jail && !start && !parking && !chance && !event && !tax)
    return null;
  return (
    <svg
      className={`mono-cell-art art-${train ? 'train' : water ? 'water' : energy ? 'energy' : jail ? 'jail' : start ? 'start' : parking ? 'parking' : chance ? 'chance' : 'event'}`}
      viewBox="0 0 64 64"
      aria-hidden="true"
      fill="none"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      {tax ? (
        <>
          <circle cx="32" cy="32" r="25" fill="#d4bc80" stroke="#88713e" strokeWidth="2" />
          <circle cx="32" cy="32" r="19" stroke="#f1dfac" strokeWidth="2" />
          <path
            d="m18 26 14-10 14 10H18zm3 5h22M22 45h20M25 31v11m7-11v11m7-11v11"
            stroke="#806739"
            strokeWidth="3"
          />
        </>
      ) : start ? (
        <>
          <circle cx="31" cy="32" r="25" fill="#a6d4aa" />
          <path d="M9 29h27V17l20 16-20 16V37H9z" fill="#248456" stroke="#15573b" strokeWidth="2" />
          <path d="M16 24h15M12 43h16" stroke="#e7f1cf" strokeWidth="3" />
        </>
      ) : jail ? (
        <>
          <rect
            x="9"
            y="7"
            width="46"
            height="50"
            rx="9"
            fill="#edaa58"
            stroke="#8a4c28"
            strokeWidth="2"
          />
          <rect x="16" y="14" width="32" height="37" rx="3" fill="#4d4240" />
          <circle cx="32" cy="30" r="9" fill="#f4cc92" />
          <path d="M22 48c0-14 20-14 20 0" fill="#bd713b" />
          <path
            d="M21 14v37M32 14v37M43 14v37M16 23h32M16 43h32"
            stroke="#cbd2cd"
            strokeWidth="3"
          />
          <path d="M16 12h32" stroke="#fff0c0" strokeWidth="2" />
          {index === 30 && <path d="M48 48h11m-5-5 5 5-5 5" stroke="#984635" strokeWidth="3" />}
        </>
      ) : parking ? (
        <>
          <circle cx="32" cy="32" r="27" fill="#efc2b7" />
          <path d="m16 29 7-12h20l7 12v17H14V33z" fill="#d75053" stroke="#7a3940" strokeWidth="2" />
          <path d="m25 21-5 10h24l-4-10z" fill="#c3e2df" />
          <path d="M18 37h6m16 0h6" stroke="#ffe3a1" strokeWidth="4" />
          <path d="M18 44v6m28-6v6" stroke="#49484b" strokeWidth="6" />
          <path d="M28 38h8" stroke="#f7e4cc" strokeWidth="2" />
        </>
      ) : train ? (
        <>
          <path d="M12 55h42M19 49l-5 10m32-10 6 10" stroke="#556b77" strokeWidth="3" />
          <path d="M13 27h27v20H13z" fill="#4d758b" stroke="#2d4d61" strokeWidth="2" />
          <path d="M35 17h16v30H35z" fill="#467865" stroke="#294f46" strokeWidth="2" />
          <path d="M32 16h22" stroke="#2d4d61" strokeWidth="4" />
          <rect x="40" y="22" width="7" height="11" rx="1" fill="#c4e6dc" />
          <path d="M18 28V17h7v11" fill="#526b79" stroke="#2d4d61" strokeWidth="2" />
          <circle cx="21" cy="10" r="5" fill="#b9cbd0" />
          <circle cx="28" cy="6" r="4" fill="#d7e1dd" />
          {[19, 32, 46].map((x) => (
            <g key={x}>
              <circle cx={x} cy="47" r="7" fill="#374f60" stroke="#b7c7c6" strokeWidth="2" />
              <circle cx={x} cy="47" r="2" fill="#d2ddcf" />
            </g>
          ))}
          <path d="M19 47h27" stroke="#d1b68a" strokeWidth="2" />
        </>
      ) : water ? (
        <>
          <circle cx="32" cy="31" r="26" fill="#b5dfdf" />
          <path
            d="M32 7S15 28 15 38a17 17 0 0 0 34 0C49 28 32 7 32 7z"
            fill="#468fae"
            stroke="#285d7d"
            strokeWidth="2"
          />
          <path d="M25 30c-6 8-4 13 1 16" stroke="#d9f4ed" strokeWidth="4" />
          <path d="M6 56q7-6 14 0t14 0 14 0 10 0" stroke="#4b809a" strokeWidth="3" />
        </>
      ) : energy ? (
        <>
          <circle cx="32" cy="32" r="26" fill="#f3d997" />
          <path
            d="M35 5 15 36h17l-3 23 21-33H33z"
            fill="#e0a23d"
            stroke="#8c642c"
            strokeWidth="2"
          />
          <path d="m18 13-4-5m36 38 5 4M10 25H5m51-7 4-2" stroke="#bd8a39" strokeWidth="3" />
        </>
      ) : (
        <>
          <path
            d="m12 10 33-3 9 44-34 7z"
            fill={chance ? '#c29a59' : '#598da2'}
            stroke={chance ? '#7f6037' : '#365e73'}
            strokeWidth="2"
          />
          <rect
            x="10"
            y="10"
            width="36"
            height="45"
            rx="5"
            fill={chance ? '#f1dfa6' : '#c9e1da'}
            stroke={chance ? '#977b43' : '#4a7180'}
            strokeWidth="2"
          />
          {chance ? (
            <>
              <path d="M21 25c0-10 17-10 17-1 0 6-9 6-9 13" stroke="#8b6b35" strokeWidth="5" />
              <circle cx="29" cy="45" r="2.8" fill="#8b6b35" />
            </>
          ) : (
            <>
              <path d="m15 26 13-9 13 9-13 9z" fill="#638d9a" />
              <path d="M18 29v13h20V29M25 42V31h6v11" stroke="#467487" strokeWidth="2" />
            </>
          )}
        </>
      )}
    </svg>
  );
}
