const categoryPalette = [
  ["#c6a8ef", "#e4d7fb"],
  ["#a5f1d4", "#dcfff2"],
  ["#f8f9a1", "#ffffd9"],
  ["#f2a8ec", "#fbdcfa"],
  ["#9ecaf1", "#dfedff"],
  ["#f6b678", "#ffead5"],
  ["#f1a295", "#ffe1db"],
  ["#73c8b3", "#d6f2e8"],
  ["#c1da82", "#edf5d5"],
  ["#b5bfd1", "#e7ecf5"],
  ["#d7bf96", "#f5ead7"],
  ["#8ddfeb", "#dff8fb"],
];

/** Shared category colors stay consistent across the board, saved budgets and chat. */
export function categoryColors(index) {
  const position = Math.max(0, Math.trunc(Number(index) || 0));
  const hue = ((position * 137.507764 + 281) % 360).toFixed(3);
  const [category, card] = categoryPalette[position] || [
    `hsl(${hue} 64% 77%)`,
    `hsl(${hue} 74% 91%)`,
  ];
  return `--category-color:${category};--card-color:${card}`;
}

/** Escape text before inserting it into HTML text or quoted attributes. */
export function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
}

export function money(value, short = false) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: short ? 0 : 2,
    maximumFractionDigits: short ? 0 : 2,
  }).format(Number.isFinite(value) ? value : 0);
}

// Static SVG geometry keeps the interface independent of icon packages or a build step.
const paths = {
  gripvertical:
    '<circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/>',
  calculator:
    '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 6h8M8 10h2M14 10h2M8 14h2M14 14h2M8 18h2M14 18h2"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  heart:
    '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  leaf: '<path d="M20.5 3.5C11 1 2 7 4 15c1.7 7.1 12 7.3 15-1 1-2.8 1-6.6 1.5-10.5Z"/><path d="M3 22 16 9M8 17l-1-5M12 13l5 1"/>',
  star: '<path d="m12 3 2.8 5.7 6.3.9-4.6 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3L3 9.6l6.3-.9Z"/>',
  wallet:
    '<path d="M21 8H5a2 2 0 0 1 0-4h14v4M3 6v13a2 2 0 0 0 2 2h16V8M21 12h-5v5h5"/><path d="M17.5 14.5h.01"/>',
  coins:
    '<ellipse cx="9" cy="6" rx="6" ry="3"/><path d="M3 6v5c0 1.7 2.7 3 6 3s6-1.3 6-3V6M3 11v5c0 1.7 2.7 3 6 3 1.2 0 2.4-.2 3.3-.5"/><path d="M16 9c3.3 0 6 1.3 6 3s-2.7 3-6 3M22 12v5c0 1.7-2.7 3-6 3"/>',
  users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/><circle cx="9" cy="7" r="4"/>',
  user: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2"/>',
  sparkles:
    '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4M18 4h4M3 18v4M1 20h4"/>',
  arrowright: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  arrowupright: '<path d="M7 17 17 7M7 7h10v10"/>',
  arrowdowntoline: '<path d="M12 3v12m-5-5 5 5 5-5M4 20h16"/>',
  arrowleft: '<path d="M19 12H5m6-6-6 6 6 6"/>',
  chevronright: '<path d="m9 5 7 7-7 7"/>',
  chevrondown: '<path d="m6 9 6 6 6-6"/>',
  chevronleft: '<path d="m15 5-7 7 7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  checkcircle2: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  pencil: '<path d="m16 3 5 5-12 12-6 1 1-6ZM13 6l5 5"/>',
  trash2: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  search: '<circle cx="10.5" cy="10.5" r="7.5"/><path d="m16 16 5 5"/>',
  slidershorizontal:
    '<path d="M3 6h6m4 0h8M3 12h12m4 0h2M3 18h2m4 0h12M9 3v6M15 9v6M5 15v6"/>',
  settings2:
    '<path d="M3 6h6m4 0h8M3 18h12m4 0h2"/><circle cx="11" cy="6" r="2"/><circle cx="17" cy="18" r="2"/>',
  settings:
    '<path d="m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h6l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>',
  circlehelp:
    '<circle cx="12" cy="12" r="9"/><path d="M9.2 9a3 3 0 0 1 5.8 1c0 2-3 2-3 4M12 17h.01"/>',
  shieldcheck:
    '<path d="M12 3 3 7v5c0 5 9 10 9 10s9-5 9-10V7Z"/><path d="m8 12 3 3 5-6"/>',
  morehorizontal:
    '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  mapin:
    '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  utensils: '<path d="M4 3v7a3 3 0 0 0 6 0V3M7 3v19M20 22V3c-5 2-5 9 0 10"/>',
  music:
    '<path d="M9 18V5l12-2v13M9 8l12-2"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="18" cy="16" rx="3" ry="3"/>',
  camera: '<path d="M3 7h4l2-3h6l2 3h4v14H3Z"/><circle cx="12" cy="13" r="4"/>',
  cake: '<path d="M4 10h16v11H4ZM4 14c2 3 4 3 6 0 2 3 4 3 6 0 1 2 3 3 4 0M8 10V6M12 10V6M16 10V6M8 2v1M12 2v1M16 2v1"/>',
  flower:
    '<path d="M12 8c-4-9-11-2-6 2-9 1-6 11 1 8-1 9 10 9 10 1 8 3 11-8 3-9 5-6-4-12-8-2Z"/><circle cx="12" cy="13" r="3"/>',
  shirt: '<path d="m8 3-6 4 3 5 3-2v11h8V10l3 2 3-5-6-4a4 4 0 0 1-8 0Z"/>',
  gift: '<path d="M3 8h18v5H3ZM5 13v8h14v-8M12 8v13"/><path d="M12 8H7a3 3 0 1 1 3-3ZM12 8h5a3 3 0 1 0-3-3Z"/>',
  church: '<path d="M12 2v6M9 5h6M3 21v-8l9-5 9 5v8ZM9 21v-6h6v6"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
  calendardays:
    '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M7 15h2M12 15h2M17 15h.01M7 18h2M12 18h2"/>',
  layoutdashboard:
    '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  upload: '<path d="M12 15V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  messagecircle: '<path d="M21 12a9 9 0 0 1-13 8L3 21l1-5a9 9 0 1 1 17-4Z"/>',
  send: '<path d="m22 2-7 20-4-9-9-4ZM22 2 11 13"/>',
  keyround:
    '<circle cx="8" cy="8" r="5"/><path d="m11.5 11.5 9 9M16 16l3-3M19 19l3-3"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff:
    '<path d="m3 3 18 18M9 5.5a11 11 0 0 1 3-.5c6 0 10 7 10 7a23 23 0 0 1-4 4M6 6C3 8 2 12 2 12s4 7 10 7a12 12 0 0 0 5-1M10 10a3 3 0 0 0 4 4"/>',
  refreshcw:
    '<path d="M20 8a8 8 0 0 0-14-3L3 8M3 3v5h5M4 16a8 8 0 0 0 14 3l3-3M21 21v-5h-5"/>',
  loadercircle: '<path d="M21 12a9 9 0 1 1-9-9"/>',
  externalink: '<path d="M14 3h7v7M10 14 21 3M10 3H3v18h18v-7"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  armchair:
    '<path d="M6 11V6a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v5M5 21v-3M19 21v-3M5 10a2 2 0 0 0-2 2v6h18v-6a2 2 0 0 0-4 0v3H7v-3a2 2 0 0 0-2-2Z"/>',
};

const aliases = {
  mappin: "mapin",
  local: "mapin",
  venue: "mapin",
  utensilscrossed: "utensils",
  food: "utensils",
  buffet: "utensils",
  music2: "music",
  musica: "music",
  cakeslice: "cake",
  bolo: "cake",
  flower2: "flower",
  flowers: "flower",
  flores: "flower",
  vestido: "shirt",
  dress: "shirt",
  trajes: "shirt",
  suit: "shirt",
  photo: "camera",
  photographer: "camera",
  decor: "armchair",
  decoration: "armchair",
  decoração: "armchair",
  heartHandshake: "church",
  hearthandshake: "church",
  celebrant: "church",
  ceremony: "church",
  gifts: "gift",
  helpcircle: "circlehelp",
  checkcircle: "checkcircle2",
  externallink: "externalink",
  info: "circlehelp",
  coinsicon: "coins",
};

export function icon(name, size = 18, filled = false) {
  const normalized = String(name ?? "")
    .replace(/[-_\s]/g, "")
    .toLowerCase();
  const key = Object.hasOwn(aliases, normalized)
    ? aliases[normalized]
    : normalized;
  const shape = Object.hasOwn(paths, key) ? paths[key] : paths.heart;
  const dimension = Number.isFinite(Number(size))
    ? Math.max(8, Math.min(160, Number(size)))
    : 18;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dimension}" height="${dimension}" viewBox="0 0 24 24" fill="${filled ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shape}</svg>`;
}

/** Filled navigation icons match the supplied compact sidebar. */
export function navigationIcon(name) {
  const shapes = {
    ai: '<path d="M16 2l4 8 9 6-9 5-4 9-5-9-9-5 9-6Z"/><path d="m28 0 2 4 4 2-4 2-2 4-2-4-4-2 4-2Z"/><text x="16" y="19" text-anchor="middle" font-family="Arial,sans-serif" font-size="8" font-weight="700" fill="white">IA</text>',
    saved: '<path d="M8 4h17a2 2 0 0 1 2 2v25l-11-6-10 6V6a2 2 0 0 1 2-2Z"/>',
    strategies:
      '<circle cx="17" cy="17" r="15"/><text x="17" y="25" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" font-weight="700" fill="white">$</text>',
    suppliers:
      '<circle cx="17" cy="9" r="5"/><circle cx="5" cy="12" r="4"/><circle cx="29" cy="12" r="4"/><path d="M9 31V22a8 8 0 0 1 16 0v9ZM0 29v-8a5 5 0 0 1 8-4L7 29ZM27 29l-1-12a5 5 0 0 1 8 4v8Z"/>',
    wedding:
      '<rect x="4" y="7" width="26" height="24" rx="3" fill="none" stroke="currentColor" stroke-width="3"/><path d="M4 14h26M10 2v9M24 2v9" fill="none" stroke="currentColor" stroke-width="3"/><path d="M9 18h4v4H9ZM16 18h4v4h-4ZM23 18h3v4h-3ZM9 24h4v4H9ZM16 24h4v4h-4Z"/>',
    board:
      '<rect x="3" y="5" width="8" height="23" rx="2"/><rect x="14" y="5" width="8" height="15" rx="2"/><rect x="25" y="5" width="8" height="20" rx="2"/>',
    clear:
      '<path d="M8 10h20l-2 22H10ZM5 6h26v3H5ZM13 2h10v3H13Z"/><path d="M15 14v13M21 14v13" fill="none" stroke="white" stroke-width="2"/>',
  };
  return `<svg viewBox="0 0 36 36" width="32" height="32" fill="currentColor" aria-hidden="true">${shapes[name] || shapes.board}</svg>`;
}
