import type { CSSProperties } from 'react';
const paths = {
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></>,
  add: <><path d="M12 5v14M5 12h14"/></>,
  upload: <><path d="M12 16V3M7 8l5-5 5 5M4 15v5h16v-5"/></>,
  download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></>,
  rotate: <><path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/></>,
  merge: <><path d="M5 3v5l7 5v8M19 3v5l-7 5M8 17l4 4 4-4"/></>,
  split: <><path d="M12 21v-8L5 8V3m7 10 7-5V3M2 6l3-3 3 3M16 6l3-3 3 3"/></>,
  number: <><path d="M9 3 7 21M17 3l-2 18M4 8h16M3 16h16"/></>,
  shield: <><path d="M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6Z"/><path d="m8 12 3 3 5-6"/></>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></>,
  arrow: <path d="m14 5-7 7 7 7M7 12h14"/>,
  check: <path d="m5 12 4 4L19 6"/>,
  moon: <path d="M20 13A9 9 0 0 1 11 4a9 9 0 1 0 9 9Z"/>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2m-3-8-1 1M6 18l-1 1M5 5l1 1m12 12 1 1"/></>,
  help: <><circle cx="12" cy="12" r="10"/><path d="M9 8a3 3 0 0 1 6 1c0 2-3 2-3 4M12 17h.01"/></>,
  eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
  info: <><circle cx="12" cy="12" r="10"/><path d="M12 10v7M12 7h.01"/></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
};
export type IconName = keyof typeof paths;
export function Icon({ name, size = 20, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>{paths[name]}</svg>;
}
