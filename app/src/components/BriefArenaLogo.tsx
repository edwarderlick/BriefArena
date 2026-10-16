import React from 'react';

interface BriefArenaLogoProps {
  className?: string;
  title?: string;
}

export const BriefArenaLogo: React.FC<BriefArenaLogoProps> = ({
  className = "w-9 h-9",
  title = "BriefArena Logo - Creative Brief with Three Entrants Converging on One Winner",
}) => {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 ${className}`}
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      
      {/* Dark forest green container squircle */}
      <rect width="32" height="32" rx="7" fill="#042217" />
      <rect
        x="0.75"
        y="0.75"
        width="30.5"
        height="30.5"
        rx="6.25"
        stroke="#2BEA96"
        strokeWidth="1.5"
        strokeOpacity="0.35"
      />

      {/* Creative Brief Folio Contour with Top-Right Fold */}
      <path
        d="M 7 5.5 C 7 4.7 7.7 4 8.5 4 L 20 4 L 26 10 L 26 25.5 C 26 26.3 25.3 27 24.5 27 L 8.5 27 C 7.7 27 7 26.3 7 25.5 Z"
        fill="#0A2D20"
        stroke="#2BEA96"
        strokeWidth="1"
        strokeOpacity="0.5"
      />
      
      {/* Editorial Folded Corner Accent */}
      <path
        d="M 20 4 L 20 9.5 C 20 9.8 20.2 10 20.5 10 L 26 10 Z"
        fill="#2BEA96"
        fillOpacity="0.25"
        stroke="#2BEA96"
        strokeWidth="1"
        strokeLinejoin="round"
      />

      {/* Three Entrants Converging on One Winner */}
      {/* Entrant 1 (Left path) */}
      <path
        d="M 10.5 23.5 C 11.5 18.5, 14.5 15.5, 16 14"
        stroke="#C9EAD7"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      {/* Entrant 2 (Center path) */}
      <path
        d="M 16 24 L 16 14"
        stroke="#2BEA96"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      {/* Entrant 3 (Right path) */}
      <path
        d="M 21.5 23.5 C 20.5 18.5, 17.5 15.5, 16 14"
        stroke="#C9EAD7"
        strokeWidth="1.6"
        strokeLinecap="round"
      />

      {/* 3 Entry Slot Nodes at the Base */}
      <circle cx="10.5" cy="23.5" r="1.3" fill="#042217" stroke="#C9EAD7" strokeWidth="1.2" />
      <circle cx="16" cy="24" r="1.4" fill="#042217" stroke="#2BEA96" strokeWidth="1.3" />
      <circle cx="21.5" cy="23.5" r="1.3" fill="#042217" stroke="#C9EAD7" strokeWidth="1.2" />

      {/* Single Crowned Winner Star at the Convergence Apex */}
      <path
        d="M 16 5.5 C 16 8.5, 14.2 10.2, 12 10.5 C 14.2 10.8, 16 12.5, 16 15.5 C 16 12.5, 17.8 10.8, 20 10.5 C 17.8 10.2, 16 8.5, 16 5.5 Z"
        fill="#FFFFFF"
      />
      {/* Glowing Inner Mint Gem */}
      <circle cx="16" cy="10.5" r="1.2" fill="#2BEA96" />
    </svg>
  );
};
