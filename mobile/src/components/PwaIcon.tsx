import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type PwaIconName =
  | 'grid'
  | 'menu'
  | 'list'
  | 'user'
  | 'cart'
  | 'search'
  | 'chevronDown'
  | 'chevronLeft'
  | 'chevronRight'
  | 'pencil'
  | 'move'
  | 'transfer'
  | 'plus'
  | 'minus'
  | 'close'
  | 'bag'
  | 'clock'
  | 'info'
  | 'rotateCcw'
  | 'undoAction'
  | 'check'
  | 'eye'
  | 'speaker'
  | 'chart'
  | 'trash'
  | 'qr'
  | 'radio'
  | 'power'
  | 'dotsVertical'
  | 'adminStats'
  | 'adminOrders'
  | 'adminStaff'
  | 'adminReconcile'
  | 'adminJournal'
  | 'adminSettings'
  | 'adminPrinter'
  | 'adminWarehouse'
  | 'logout';

export function PwaIcon({
  name,
  size = 22,
  color,
  strokeWidth = 1.8,
}: {
  name: PwaIconName;
  size?: number;
  color: string;
  strokeWidth?: number;
}) {
  const common = {
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {name === 'grid' && (
        <>
          <Rect x="3" y="3" width="7" height="7" rx="1.5" {...common} />
          <Rect x="14" y="3" width="7" height="7" rx="1.5" {...common} />
          <Rect x="3" y="14" width="7" height="7" rx="1.5" {...common} />
          <Rect x="14" y="14" width="7" height="7" rx="1.5" {...common} />
        </>
      )}
      {name === 'menu' && <Path d="M4 6h16M4 12h16M4 18h10" {...common} />}
      {name === 'list' && <Path d="M8 6h12M8 12h12M8 18h12M3.5 6h.01M3.5 12h.01M3.5 18h.01" {...common} />}
      {name === 'user' && (
        <>
          <Circle cx="12" cy="8" r="4" {...common} />
          <Path d="M4 21c0-4 4-6 8-6s8 2 8 6" {...common} />
        </>
      )}
      {name === 'cart' && (
        <>
          <Path d="M3 4h2l2.4 12.3a1 1 0 0 0 1 .7h8.7a1 1 0 0 0 1-.8L21 8H6" {...common} />
          <Circle cx="9" cy="20" r="1.4" {...common} />
          <Circle cx="18" cy="20" r="1.4" {...common} />
        </>
      )}
      {name === 'search' && (
        <>
          <Circle cx="11" cy="11" r="7" {...common} />
          <Path d="m20 20-3-3" {...common} />
        </>
      )}
      {name === 'chevronDown' && <Path d="m6 9 6 6 6-6" {...common} strokeWidth={2} />}
      {name === 'chevronLeft' && <Path d="m15 18-6-6 6-6" {...common} strokeWidth={2} />}
      {name === 'chevronRight' && <Path d="m9 18 6-6-6-6" {...common} strokeWidth={2} />}
      {name === 'pencil' && <Path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" {...common} />}
      {name === 'move' && <Path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20" {...common} />}
      {name === 'transfer' && <Path d="M16 3h5v5M21 3l-7 7M8 21H3v-5M3 21l7-7" {...common} />}
      {name === 'plus' && <Path d="M5 12h14M12 5v14" {...common} strokeWidth={2.4} />}
      {name === 'minus' && <Path d="M5 12h14" {...common} strokeWidth={2.4} />}
      {name === 'close' && <Path d="M18 6 6 18M6 6l12 12" {...common} strokeWidth={2} />}
      {name === 'bag' && (
        <>
          <Path d="M6 2 4 6v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6l-2-4Z" {...common} strokeWidth={2} />
          <Path d="M4 6h16M16 10a4 4 0 0 1-8 0" {...common} strokeWidth={2} />
        </>
      )}
      {name === 'clock' && (
        <>
          <Circle cx="12" cy="12" r="9" {...common} strokeWidth={2} />
          <Path d="M12 7v5l3 2" {...common} strokeWidth={2} />
        </>
      )}
      {name === 'info' && (
        <>
          <Circle cx="12" cy="12" r="9" {...common} strokeWidth={2} />
          <Path d="M12 16v-4M12 8h.01" {...common} strokeWidth={2} />
        </>
      )}
      {name === 'rotateCcw' && (
        <>
          <Path d="M3 7v6h6" {...common} strokeWidth={2} />
          <Path d="M3 13a9 9 0 1 0 3-7.7L3 8" {...common} strokeWidth={2} />
        </>
      )}
      {name === 'undoAction' && (
        <Path
          d="M13.8 7.8H8.2m0 0 2.45-2.45M8.2 7.8l2.45 2.45M8.65 7.8h5.65a4.65 4.65 0 1 1 0 9.3h-3.4"
          {...common}
          strokeWidth={2.35}
        />
      )}
      {name === 'check' && <Path d="M20 6 9 17l-5-5" {...common} strokeWidth={2.5} />}
      {name === 'trash' && (
        <>
          <Path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" {...common} strokeWidth={2} />
          <Path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" {...common} strokeWidth={2} />
        </>
      )}
      {name === 'qr' && (
        <>
          <Rect x="3" y="3" width="7" height="7" rx="1" {...common} strokeWidth={2} />
          <Rect x="14" y="3" width="7" height="7" rx="1" {...common} strokeWidth={2} />
          <Rect x="3" y="14" width="7" height="7" rx="1" {...common} strokeWidth={2} />
          <Path d="M14 14h3v3M21 14v3M17 21h4M14 18v3" {...common} strokeWidth={2} />
        </>
      )}
      {name === 'radio' && (
        <>
          <Path d="M10.5 3.5h3M12 3.5v3.25" {...common} strokeWidth={2} />
          <Rect x="7" y="6.5" width="10" height="14" rx="2.25" {...common} strokeWidth={2} />
          <Circle cx="12" cy="10.3" r="0.9" fill={color} />
          <Path d="M10 13.3h4M10 15.8h4M10 18.3h4" {...common} strokeWidth={1.75} />
        </>
      )}
      {name === 'power' && (
        <>
          <Path d="M12 2v10" {...common} strokeWidth={2.2} />
          <Path d="M6.4 6.6a8 8 0 1 0 11.2 0" {...common} strokeWidth={2.2} />
        </>
      )}
      {name === 'chart' && (
        <>
          <Path d="M3 3v18h18" {...common} strokeWidth={2} />
          <Path d="M7 15v3M12 10v8M17 6v12" {...common} strokeWidth={2.4} />
        </>
      )}
      {name === 'eye' && (
        <>
          <Path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" {...common} strokeWidth={2} />
          <Circle cx="12" cy="12" r="3" {...common} strokeWidth={2} />
        </>
      )}
      {name === 'speaker' && (
        <>
          <Path d="M11 5 6 9H3v6h3l5 4V5Z" {...common} strokeWidth={2} />
          <Path d="M15.5 8.5a5 5 0 0 1 0 7" {...common} strokeWidth={2} />
          <Path d="M18.5 5.5a9 9 0 0 1 0 13" {...common} strokeWidth={2} />
        </>
      )}
      {name === 'dotsVertical' && (
        <>
          <Circle cx="12" cy="5" r="1.6" fill={color} />
          <Circle cx="12" cy="12" r="1.6" fill={color} />
          <Circle cx="12" cy="19" r="1.6" fill={color} />
        </>
      )}
      {name === 'adminStats' && <><Path d="M3 3v18h18" {...common} /><Path d="M7 14l3-3 3 3 5-6" {...common} /></>}
      {name === 'adminOrders' && <><Rect x="4" y="3" width="16" height="18" rx="2" {...common} /><Path d="M8 8h8M8 12h8M8 16h5" {...common} /></>}
      {name === 'adminStaff' && <><Circle cx="9" cy="8" r="3.5" {...common} /><Path d="M2 21c0-3.5 3.5-5.5 7-5.5s7 2 7 5.5M17 8a3 3 0 0 1 0 6M22 21c0-2.5-1.5-4.2-3.5-5" {...common} /></>}
      {name === 'adminReconcile' && <><Path d="M9 11l3 3L22 4" {...common} /><Path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" {...common} /></>}
      {name === 'adminJournal' && <><Path d="M4 5a2 2 0 0 1 2-2h11a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2Z" {...common} /><Path d="M4 5a2 2 0 0 0 2 2h12M8 11h7M8 15h5" {...common} /></>}
      {name === 'adminSettings' && <><Circle cx="12" cy="12" r="3" {...common} /><Path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.2.62.78 1.05 1.43 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" {...common} /></>}
      {name === 'adminPrinter' && <><Path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" {...common} /><Rect x="6" y="14" width="12" height="8" rx="1" {...common} /></>}
      {name === 'adminWarehouse' && <><Path d="M3 21V8l9-5 9 5v13M3 21h18" {...common} /><Rect x="8" y="13" width="8" height="8" rx="1" {...common} /><Path d="M8 17h8" {...common} /></>}
      {name === 'logout' && <><Path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" {...common} /><Path d="M16 17l5-5-5-5M21 12H9" {...common} /></>}
    </Svg>
  );
}
