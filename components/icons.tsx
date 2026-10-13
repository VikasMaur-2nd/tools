import type { SVGProps } from 'react';

const paths = {
  format: 'M4 6h16M9 12h11M9 18h11M4 10.5 6.5 12 4 13.5',
  minify: 'M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4',
  sort: 'M4 6h9M4 12h6M4 18h3M17 5v14m0 0-3-3m3 3 3-3',
  wand: 'M4 20 14 10M14 4v2M14 14v2M19 9h2M7 9h2M17.5 5.5 18.9 4.1M17.5 12.5l1.4 1.4M10.5 5.5 9.1 4.1',
  copy: 'M9 9h10a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 21H9.5A1.5 1.5 0 0 1 8 19.5V10a1 1 0 0 1 1-1ZM16 9V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8',
  download: 'M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14',
  open: 'M3.5 7.5v10A1.5 1.5 0 0 0 5 19h14a1.5 1.5 0 0 0 1.5-1.5V9.5A1.5 1.5 0 0 0 19 8h-7l-2-2.5H5A1.5 1.5 0 0 0 3.5 7Z',
  trash: 'M5 7h14M10 11v6M14 11v6M6.5 7l.8 11.6A1.5 1.5 0 0 0 8.8 20h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7M9.5 7V5h5v2',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  expand: 'M7 9l5-5 5 5M7 15l5 5 5-5',
  collapse: 'M7 4l5 5 5-5M7 20l5-5 5 5',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z',
  system: 'M4 5h16v11H4zM9 20h6M12 16v4',
  command: 'M9 6.5A2.5 2.5 0 1 0 6.5 9H9V6.5ZM9 9h6v6H9zM15 6.5V9h2.5A2.5 2.5 0 1 0 15 6.5ZM9 17.5V15H6.5A2.5 2.5 0 1 0 9 17.5ZM15 15v2.5a2.5 2.5 0 1 0 2.5-2.5H15Z',
  lock: 'M6.5 11h11a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18.5v-6A1.5 1.5 0 0 1 6.5 11ZM8 11V8a4 4 0 0 1 8 0v3',
  link: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1',
  paste: 'M9 4.5h6v2.5H9zM15 5.5h2.5A1.5 1.5 0 0 1 19 7v12.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5V7a1.5 1.5 0 0 1 1.5-1.5H9',
  file: 'M6.5 3.5h7l4.5 4.5v11.5a1 1 0 0 1-1 1h-10.5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1ZM13.5 3.5V8H18',
  tree: 'M5 4v15.5M5 8h5M5 15h5M13 8h6M13 15h6M13 4h6',
  table: 'M4 5h16v14H4zM4 10h16M4 14.5h16M10 10v9',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6 6 18',
  alert: 'M12 4 2.8 19.5h18.4L12 4ZM12 10v4.5M12 17v.01',
  keyboard: 'M3.5 7h17v10h-17zM7 10.5h.01M10 10.5h.01M13 10.5h.01M16 10.5h.01M8 14h8',
  path: 'M5 19 19 5M8 5h11v11',
  braces: 'M8 4H7a2 2 0 0 0-2 2v3.5A2.5 2.5 0 0 1 2.5 12 2.5 2.5 0 0 1 5 14.5V18a2 2 0 0 0 2 2h1M16 4h1a2 2 0 0 1 2 2v3.5a2.5 2.5 0 0 0 2.5 2.5 2.5 2.5 0 0 0-2.5 2.5V18a2 2 0 0 1-2 2h-1',
  code: 'M8.5 7 3.5 12l5 5M15.5 7l5 5-5 5M13.5 4.5l-3 15',
  diff: 'M8 3.5v7M4.5 7h7M12.5 17h7M5 20.5 19 3.5',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9S9.5 5.5 12 3Z',
  swap: 'M4 8h15m0 0-3.5-3.5M19 8l-3.5 3.5M20 16H5m0 0 3.5-3.5M5 16l3.5 3.5',
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 16, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={paths[name]} />
    </svg>
  );
}
