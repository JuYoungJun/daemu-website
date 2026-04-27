/* Inline SVG illustrations for error pages.
   Pure CSS-driven animations (see styles/errors.css). */

export function CroissantRolling() {
  return (
    <svg viewBox="0 0 240 200">
      <g className="motion">
        <path d="M30 130 q-12 -2 -22 0" strokeWidth="2" fill="none" />
        <path d="M22 116 q-10 -2 -18 0" strokeWidth="2" fill="none" />
        <path d="M28 144 q-12 -2 -22 0" strokeWidth="2" fill="none" />
      </g>
      <g className="croissant-roll" style={{ transformOrigin: '120px 130px' }}>
        {/* Croissant body — crescent shape */}
        <g transform="translate(120 130)">
          <ellipse cx="0" cy="0" rx="38" ry="22" fill="#d8a25d" />
          <path
            d="M-32 -4 q0 -22 32 -22 q32 0 32 22"
            fill="#c08742"
            stroke="#8c5a25"
            strokeWidth="1.4"
          />
          <path d="M-24 -2 l4 -10" stroke="#8c5a25" strokeWidth="1.5" fill="none" />
          <path d="M-8 -8 l3 -10" stroke="#8c5a25" strokeWidth="1.5" fill="none" />
          <path d="M8 -8 l-3 -10" stroke="#8c5a25" strokeWidth="1.5" fill="none" />
          <path d="M24 -2 l-4 -10" stroke="#8c5a25" strokeWidth="1.5" fill="none" />
          {/* highlight */}
          <ellipse cx="-12" cy="-6" rx="9" ry="3" fill="#ecc488" opacity=".7" />
          <ellipse cx="14" cy="-4" rx="6" ry="2" fill="#ecc488" opacity=".55" />
        </g>
      </g>
    </svg>
  );
}

export function OvenSmoking() {
  return (
    <svg viewBox="0 0 240 200">
      {/* steam puffs */}
      <g>
        <circle className="steam-puff" cx="100" cy="60" r="6" fill="#bdb6ad" opacity=".7" />
        <circle className="steam-puff delay1" cx="120" cy="50" r="7" fill="#bdb6ad" opacity=".7" />
        <circle className="steam-puff delay2" cx="140" cy="62" r="6" fill="#bdb6ad" opacity=".7" />
      </g>
      {/* oven body */}
      <g className="oven-glow">
        <rect x="50" y="80" width="140" height="100" rx="6" fill="#3b3733" />
        <rect x="58" y="88" width="124" height="60" rx="4" fill="#1f1d1b" />
        {/* glow */}
        <rect x="62" y="92" width="116" height="52" rx="3" fill="#d96a2c" opacity=".25" />
        {/* failed loaf inside */}
        <ellipse cx="120" cy="128" rx="34" ry="14" fill="#3a2a1c" />
        <path d="M92 128 q14 -10 28 -8 q14 -2 28 8" fill="#5a3a22" />
        <line x1="100" y1="124" x2="108" y2="118" stroke="#0c0a08" strokeWidth="1.5" />
        <line x1="120" y1="120" x2="128" y2="116" stroke="#0c0a08" strokeWidth="1.5" />
        <line x1="138" y1="124" x2="146" y2="120" stroke="#0c0a08" strokeWidth="1.5" />
        {/* control panel */}
        <rect x="58" y="156" width="124" height="18" rx="2" fill="#28241f" />
        <circle cx="74" cy="165" r="4" fill="#d96a2c" className="blink-soft" />
        <circle cx="92" cy="165" r="3" fill="#666" />
        <rect x="108" y="161" width="60" height="8" rx="1.5" fill="#1a1816" />
        {/* legs */}
        <rect x="58" y="180" width="6" height="8" fill="#28241f" />
        <rect x="176" y="180" width="6" height="8" fill="#28241f" />
      </g>
    </svg>
  );
}

export function ShopClosed() {
  return (
    <svg viewBox="0 0 240 200">
      {/* sign rope shadow */}
      <line x1="120" y1="20" x2="120" y2="46" stroke="#a09a92" strokeWidth="1.5" />
      {/* swinging CLOSED sign */}
      <g className="door-shake" style={{ transformOrigin: '120px 46px' }}>
        <rect x="64" y="46" width="112" height="62" rx="3" fill="#f6f2ea" stroke="#2a2724" strokeWidth="2" />
        <text
          x="120" y="78"
          textAnchor="middle"
          fontFamily="'Cormorant Garamond', serif"
          fontSize="22"
          fontWeight="500"
          fill="#2a2724"
          letterSpacing="2"
        >CLOSED</text>
        <text
          x="120" y="98"
          textAnchor="middle"
          fontFamily="'Noto Sans KR', sans-serif"
          fontSize="9"
          fill="#7a746c"
          letterSpacing="3"
        >영업 준비중</text>
        {/* hooks */}
        <circle cx="80" cy="46" r="2.5" fill="#2a2724" />
        <circle cx="160" cy="46" r="2.5" fill="#2a2724" />
      </g>
      {/* ground / counter */}
      <g className="bob">
        <rect x="40" y="138" width="160" height="6" rx="1" fill="#c8c0b3" />
        <path d="M40 144 L200 144 L188 168 L52 168 Z" fill="#2a2724" />
        {/* keyhole */}
        <circle cx="120" cy="156" r="3" fill="#d8a25d" />
        <rect x="118.5" y="156" width="3" height="6" fill="#d8a25d" />
      </g>
    </svg>
  );
}

export function BreadRising() {
  return (
    <svg viewBox="0 0 240 200">
      {/* steam */}
      <g>
        <circle className="steam-puff" cx="110" cy="70" r="5" fill="#bdb6ad" opacity=".7" />
        <circle className="steam-puff delay1" cx="128" cy="60" r="6" fill="#bdb6ad" opacity=".7" />
        <circle className="steam-puff delay2" cx="146" cy="70" r="5" fill="#bdb6ad" opacity=".7" />
      </g>
      {/* tray */}
      <rect x="44" y="158" width="152" height="8" rx="1" fill="#2a2724" />
      <rect x="38" y="166" width="164" height="6" rx="1" fill="#1f1d1b" />
      {/* rising loaf */}
      <g className="bread-rise">
        <path
          d="M70 158 q0 -50 50 -50 q50 0 50 50 Z"
          fill="#d8a25d"
          stroke="#8c5a25"
          strokeWidth="1.6"
        />
        <path d="M88 142 q12 -20 32 -20" stroke="#8c5a25" strokeWidth="1.4" fill="none" />
        <path d="M110 130 q8 -16 26 -14" stroke="#8c5a25" strokeWidth="1.4" fill="none" />
        <ellipse cx="100" cy="124" rx="14" ry="3" fill="#ecc488" opacity=".7" />
        {/* cuts on top */}
        <path d="M96 116 l8 -10" stroke="#8c5a25" strokeWidth="1.5" fill="none" />
        <path d="M118 112 l6 -10" stroke="#8c5a25" strokeWidth="1.5" fill="none" />
        <path d="M138 116 l6 -8" stroke="#8c5a25" strokeWidth="1.5" fill="none" />
      </g>
    </svg>
  );
}

export function CoffeeSpill() {
  return (
    <svg viewBox="0 0 240 200">
      {/* steam */}
      <g>
        <circle className="steam-puff" cx="110" cy="64" r="5" fill="#bdb6ad" opacity=".6" />
        <circle className="steam-puff delay1" cx="128" cy="54" r="6" fill="#bdb6ad" opacity=".6" />
      </g>
      {/* tipping cup */}
      <g className="wobble" style={{ transformOrigin: '130px 150px' }}>
        <path d="M86 90 L168 90 L160 156 L94 156 Z" fill="#f6f2ea" stroke="#2a2724" strokeWidth="2" />
        <ellipse cx="127" cy="90" rx="41" ry="6" fill="#5a3a22" />
        <path d="M168 102 q22 4 22 24 q0 18 -22 22" fill="none" stroke="#2a2724" strokeWidth="2" />
        <ellipse cx="127" cy="156" rx="33" ry="4" fill="#2a2724" opacity=".25" />
      </g>
      {/* coffee puddle */}
      <ellipse cx="180" cy="172" rx="30" ry="6" fill="#5a3a22" opacity=".7" />
      <ellipse cx="78" cy="172" rx="14" ry="3" fill="#5a3a22" opacity=".5" />
    </svg>
  );
}
