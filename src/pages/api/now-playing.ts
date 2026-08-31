import type { NextApiRequest, NextApiResponse } from 'next';
import { getTheme, escapeXML, truncate, formatNumber, FONT, resolveBackground, ensureContrast, sendError, sendSvg, Theme } from '@/lib/svg';
import {
  parseUsernames,
  getUserInfo,
  getRecentTracks,
  getArtistPlays,
  getTrackPlays,
  fetchAvatar,
  dominantColor,
  LastfmError,
  RecentTrack,
} from '@/lib/lastfm';

const LASTFM_PLACEHOLDER = '2a96cbd8b46e442fc41c2b86b821562f';

// Artists to skip when picking the current/previous track (e.g. the kirtan that
// auto-runs). Comma-separated substring match via LASTFM_EXCLUDE_ARTISTS.
function isExcluded(artist?: string): boolean {
  const a = (artist || '').toLowerCase();
  return (process.env.LASTFM_EXCLUDE_ARTISTS || 'Bhai Satvinder Singh Ji')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .some((x) => a.includes(x));
}

const trackKey = (t: RecentTrack) => `${t.name}|${t.artist?.['#text'] || ''}`.toLowerCase();

function albumArt(images?: RecentTrack['image']): string | undefined {
  if (!Array.isArray(images)) return undefined;
  const url = images[3]?.['#text'] || images[2]?.['#text'];
  if (!url || url.includes(LASTFM_PLACEHOLDER)) return undefined;
  return url;
}

// Last.fm frequently has no cover for non-Western tracks (bollywood especially),
// so fall back to iTunes artwork when its own image is missing or won't load.
async function itunesArt(artist: string, album?: string, track?: string): Promise<string | undefined> {
  const term = `${artist} ${album || track || ''}`.trim();
  if (!term) return undefined;
  try {
    const r = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=1`, { signal: AbortSignal.timeout(6000) });
    const d = await r.json();
    const art: string | undefined = d?.results?.[0]?.artworkUrl100;
    return art ? art.replace('100x100bb', '600x600bb') : undefined;
  } catch {
    return undefined;
  }
}

function line(artist: string, extra: string | undefined, max: number): string {
  const full = extra ? `${artist || 'Unknown Artist'} • ${extra}` : artist || 'Unknown Artist';
  return truncate(full, max);
}

function equalizer(color: string): string {
  return [154, 161, 168, 175]
    .map(
      (x, i) => `<rect x="${x}" y="29" width="4" height="10" rx="1.5" fill="${color}">
      <animate attributeName="height" values="5;15;5" dur="${0.6 + i * 0.15}s" repeatCount="indefinite"/>
      <animate attributeName="y" values="34;24;34" dur="${0.6 + i * 0.15}s" repeatCount="indefinite"/>
    </rect>`,
    )
    .join('');
}

function miniEqualizer(x: number, baseline: number, color: string): string {
  return [0, 1, 2, 3]
    .map((i) => {
      const bx = x + i * 6;
      return `<rect x="${bx}" y="${baseline - 3}" width="3" height="6" rx="1" fill="${color}">
      <animate attributeName="height" values="3;12;3" dur="${0.5 + i * 0.12}s" repeatCount="indefinite"/>
      <animate attributeName="y" values="${baseline}; ${baseline - 9}; ${baseline}" dur="${0.5 + i * 0.12}s" repeatCount="indefinite"/>
    </rect>`;
    })
    .join('');
}

interface Data {
  current: RecentTrack;
  previous?: RecentTrack;
  art: string | null;
  artistPlays: number;
  trackPlays: number;
  total: string;
}

// Wide layout. The 500 card is built around a big title and a hero cover; at
// 940 that leaves a hole in the middle and a type scale twice everything it
// sits next to. This lays the same data out as label/value rows on the shared
// grid, so it reads as one more block in the stack rather than a music widget
// that wandered in.
function renderWide(t: Theme, d: Data): string {
  const { defs, fill } = resolveBackground(t);
  const live = Boolean(d.current['@attr']?.nowplaying);
  const accent = t.accent || '#e5342b';
  const F = t.font || FONT;

  const W = t.width || 940;
  const PAD = 30;
  const FS = 14;
  const CW = FS * 0.62;
  const asz = 104;
  const ax = W - PAD - asz;
  const ay = 62;

  const valX = PAD + 150;
  const textRight = ax - 24;
  const capFor = (x: number) => Math.max(8, Math.floor((textRight - x) / CW));

  const artist = d.current.artist?.['#text'] || 'Unknown Artist';
  const album = d.current.album?.['#text'] || '';
  const prev = d.previous
    ? `${d.previous.name} · ${d.previous.artist?.['#text'] || ''}`.replace(/ · $/, '')
    : '';

  const rows: Array<[string, string, string]> = [];
  rows.push(['track', truncate(d.current.name, capFor(valX + 18)), 'hi']);
  rows.push(['artist', truncate(artist, capFor(valX)), 'v']);
  if (album) rows.push(['album', truncate(album, capFor(valX)), 'v']);
  if (prev) rows.push(['previous', truncate(prev, capFor(valX)), 'm']);
  rows.push([
    'plays',
    `${formatNumber(d.artistPlays)} of this artist · ${formatNumber(d.trackPlays)} of this track · ${d.total} total`,
    'm',
  ]);

  const y0 = 84;
  const body = rows
    .map(([k, val, cls], i) => {
      const y = y0 + i * 26;
      // the live dot rides in front of the track value, where the eye lands
      const dot =
        k === 'track' && live
          ? `<circle cx="${valX + 5}" cy="${y - 5}" r="4" fill="${accent}"><animate attributeName="opacity" values="1;0.25;1" dur="1.3s" repeatCount="indefinite"/></circle>`
          : '';
      const vx = k === 'track' && live ? valX + 18 : valX;
      return (
        `<text x="${PAD}" y="${y}" class="bul">.</text>` +
        `<text x="${PAD + CW * 1.6}" y="${y}" class="k">${escapeXML(k)}:</text>` +
        dot +
        `<text x="${vx}" y="${y}" class="${cls}">${escapeXML(val)}</text>`
      );
    })
    .join('\n');

  const artwork = d.art
    ? `<clipPath id="art"><rect x="${ax}" y="${ay}" width="${asz}" height="${asz}" rx="10"/></clipPath>
       <image href="${d.art}" x="${ax}" y="${ay}" width="${asz}" height="${asz}" clip-path="url(#art)" preserveAspectRatio="xMidYMid slice"/>
       <rect x="${ax}" y="${ay}" width="${asz}" height="${asz}" rx="10" fill="none" stroke="${t.subtitle}" stroke-opacity="0.35"/>`
    : `<rect x="${ax}" y="${ay}" width="${asz}" height="${asz}" rx="10" fill="${t.section}" opacity="0.08"/>
       <text x="${ax + asz / 2}" y="${ay + asz / 2 + 12}" font-size="34" text-anchor="middle" fill="${t.subtitle}">♪</text>`;

  const H = Math.max(y0 + rows.length * 26 + 14, ay + asz + 22);
  const head = live ? 'now playing' : 'was playing';
  const headW = (14 + 7) * CW + 16;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none" role="img">
  ${defs}
  <style>
    .hd{font:700 ${FS + 3}px ${F};fill:${t.section}}
    .u{font:400 11px ${F};fill:${t.subtitle}}
    .k{font:400 ${FS}px ${F};fill:${t.index}}
    .bul{font:400 ${FS}px ${F};fill:${t.index}}
    .hi{font:400 ${FS}px ${F};fill:${t.section}}
    .v{font:400 ${FS}px ${F};fill:${t.item}}
    .m{font:400 ${FS}px ${F};fill:${t.stats}}
  </style>
  <rect width="${W}" height="${H}" fill="${fill}"/>
  <line x1="${PAD}" y1="0.5" x2="${W - PAD}" y2="0.5" stroke="${t.subtitle}" stroke-opacity="0.3"/>
  <text x="${PAD}" y="46" class="hd">arshnah@lastfm</text>
  <text x="${W - PAD}" y="46" text-anchor="end" class="u">${head}</text>
  <line x1="${PAD + headW}" y1="41" x2="${W - PAD - head.length * 6.6 - 14}" y2="41" stroke="${t.subtitle}" stroke-opacity="0.3"/>
  ${artwork}
  ${body}
</svg>`;
}

function renderSpotifyVertical(t: Theme, d: Data, opts: { bars: boolean; karaoke: boolean }): string {
  const { defs, fill } = resolveBackground(t);
  const W = t.width || 320;
  const PAD = 10;
  const coverSize = W - PAD * 2;
  const F = t.font || FONT;
  const live = Boolean(d.current['@attr']?.nowplaying);
  const accent = t.accent || t.section;
  const artist = d.current.artist?.['#text'] || 'Unknown Artist';
  const song = d.current.name;
  const cap = Math.max(10, Math.floor((coverSize - 10) / 8.5));

  let y = PAD + 14;
  let header = '';
  if (opts.bars) {
    const label = live ? 'NOW PLAYING' : 'RECENTLY PLAYED';
    header = `<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="${F}" font-size="13" font-weight="bold" letter-spacing="1.5" fill="${accent}">${escapeXML(label)}</text>`;
    if (live) header += miniEqualizer(W / 2 + label.length * 3.6 + 10, y, accent);
    y += 24;
  }

  let textBlock: string;
  if (opts.karaoke) {
    textBlock = `<text x="${W / 2}" y="${y + 20}" text-anchor="middle" font-family="${F}" font-size="22" font-weight="900" fill="#0000de" stroke="#f7f7f7" stroke-width="0.6">${escapeXML(truncate(song, cap))}</text>
      <text x="${W / 2}" y="${y + 48}" text-anchor="middle" font-family="${F}" font-size="22" font-weight="900" fill="#ff3333" stroke="#efefef" stroke-width="0.6">${escapeXML(truncate(artist, cap))}</text>`;
    y += 64;
  } else {
    textBlock = `<text x="${W / 2}" y="${y + 18}" text-anchor="middle" font-family="${F}" font-size="19" font-weight="bold" fill="${t.title}">${escapeXML(truncate(artist, cap))}</text>
      <text x="${W / 2}" y="${y + 40}" text-anchor="middle" font-family="${F}" font-size="15" fill="${t.subtitle}">${escapeXML(truncate(song, cap))}</text>`;
    y += 56;
  }

  const cx = PAD;
  const cy = y;
  const artwork = d.art
    ? `<clipPath id="cov"><rect x="${cx}" y="${cy}" width="${coverSize}" height="${coverSize}" rx="6"/></clipPath>
       <image href="${d.art}" x="${cx}" y="${cy}" width="${coverSize}" height="${coverSize}" clip-path="url(#cov)" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect x="${cx}" y="${cy}" width="${coverSize}" height="${coverSize}" rx="6" fill="${accent}" opacity="0.12"/>
       <text x="${cx + coverSize / 2}" y="${cy + coverSize / 2 + 16}" font-size="56" text-anchor="middle" fill="${t.subtitle}">♪</text>`;

  const H = cy + coverSize + PAD;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none" role="img">
  ${defs}
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="${t.flat ? 0 : t.radius ?? 10}" fill="${fill}"${t.flat ? '' : ` stroke="${t.subtitle}" stroke-opacity="0.18"`}/>
  ${header}
  ${textBlock}
  ${artwork}
</svg>`;
}

function renderSpotifyInline(t: Theme, d: Data, size: number): string {
  const { defs, fill } = resolveBackground(t);
  const W = t.width || (size >= 80 ? 420 : 360);
  const PAD = 16;
  const F = t.font || FONT;
  const live = Boolean(d.current['@attr']?.nowplaying);
  const accent = t.accent || t.section;
  const artist = d.current.artist?.['#text'] || 'Unknown Artist';
  const song = d.current.name;
  const H = size + PAD * 2;
  const tx = PAD + size + 14;
  const cap = Math.max(8, Math.floor((W - PAD - tx) / 7.6));

  const artwork = d.art
    ? `<clipPath id="cov2"><rect x="${PAD}" y="${PAD}" width="${size}" height="${size}" rx="4"/></clipPath>
       <image href="${d.art}" x="${PAD}" y="${PAD}" width="${size}" height="${size}" clip-path="url(#cov2)" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect x="${PAD}" y="${PAD}" width="${size}" height="${size}" rx="4" fill="${accent}" opacity="0.12"/>
       <text x="${PAD + size / 2}" y="${PAD + size / 2 + 8}" font-size="24" text-anchor="middle" fill="${t.subtitle}">♪</text>`;

  const bars = live ? miniEqualizer(tx, PAD + size - 6, accent) : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none" role="img">
  ${defs}
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="${t.flat ? 0 : t.radius ?? 10}" fill="${fill}"${t.flat ? '' : ` stroke="${t.subtitle}" stroke-opacity="0.18"`}/>
  ${artwork}
  <text x="${tx}" y="${PAD + 18}" font-family="${F}" font-size="15" font-weight="600" fill="${t.title}">${escapeXML(truncate(artist, cap))}</text>
  <text x="${tx}" y="${PAD + 38}" font-family="${F}" font-size="13" fill="${t.subtitle}">${escapeXML(truncate(song, cap))}</text>
  ${bars}
</svg>`;
}

function renderSpotifyApple(t: Theme, d: Data): string {
  const { defs, fill } = resolveBackground(t);
  const W = t.width || 345;
  const PAD = 24;
  const coverSize = W - PAD * 2;
  const F = t.font || FONT;
  const live = Boolean(d.current['@attr']?.nowplaying);
  const accent = t.accent || '#fc3c44';
  const artist = d.current.artist?.['#text'] || 'Unknown Artist';
  const song = d.current.name;
  const cap = Math.max(10, Math.floor(coverSize / 8));

  let y = PAD + 12;
  const header = `<text x="${PAD}" y="${y}" font-family="${F}" font-size="13" font-weight="700" fill="${accent}">♫ Music</text>
    <text x="${PAD + 68}" y="${y}" font-family="${F}" font-size="13" fill="${t.subtitle}">· ${live ? 'Now Playing' : 'Recently Played'}</text>`;
  y += 20;

  const cy = y;
  const artwork = d.art
    ? `<clipPath id="covA"><rect x="${PAD}" y="${cy}" width="${coverSize}" height="${coverSize}" rx="12"/></clipPath>
       <image href="${d.art}" x="${PAD}" y="${cy}" width="${coverSize}" height="${coverSize}" clip-path="url(#covA)" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect x="${PAD}" y="${cy}" width="${coverSize}" height="${coverSize}" rx="12" fill="${t.subtitle}" opacity="0.15"/>
       <text x="${PAD + coverSize / 2}" y="${cy + coverSize / 2 + 18}" font-size="56" text-anchor="middle" fill="${t.subtitle}">♪</text>`;

  const ty = cy + coverSize + 34;
  const songLine = `<text x="${PAD}" y="${ty}" font-family="${F}" font-size="18" font-weight="700" fill="${t.title}">${escapeXML(truncate(song, cap))}</text>`;
  const artistLine = `<text x="${PAD}" y="${ty + 22}" font-family="${F}" font-size="15" fill="${t.subtitle}">${escapeXML(truncate(artist, cap))}</text>`;

  const sliderY = ty + 44;
  const sliderW = coverSize;
  const fillPct = live ? 33 : 0;
  const slider = `<rect x="${PAD}" y="${sliderY}" width="${sliderW}" height="4" rx="2" fill="${t.subtitle}" opacity="0.25"/>
    <rect x="${PAD}" y="${sliderY}" width="${(sliderW * fillPct) / 100}" height="4" rx="2" fill="${t.subtitle}"/>
    <text x="${PAD}" y="${sliderY + 18}" font-family="${F}" font-size="11" fill="${t.subtitle}">0:00</text>
    <text x="${PAD + sliderW}" y="${sliderY + 18}" text-anchor="end" font-family="${F}" font-size="11" fill="${t.subtitle}">--:--</text>`;

  const H = sliderY + 34;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none" role="img">
  ${defs}
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="${t.radius ?? 18}" fill="${fill}"/>
  ${header}
  ${artwork}
  ${songLine}
  ${artistLine}
  ${slider}
</svg>`;
}

function renderSpotifyEmbed(t: Theme, d: Data): string {
  const { defs, fill } = resolveBackground(t);
  const W = t.width || 460;
  const H = 152;
  const PAD = 16;
  const size = 120;
  const F = t.font || FONT;
  const live = Boolean(d.current['@attr']?.nowplaying);
  const accent = t.accent || '#1db954';
  const artist = d.current.artist?.['#text'] || 'Unknown Artist';
  const song = d.current.name;
  const tx = PAD + size + 16;
  const textLimit = W - PAD - tx;
  const cap = Math.max(10, Math.floor(textLimit / 7.6));

  const artwork = d.art
    ? `<clipPath id="covE"><rect x="${PAD}" y="${PAD}" width="${size}" height="${size}" rx="4"/></clipPath>
       <image href="${d.art}" x="${PAD}" y="${PAD}" width="${size}" height="${size}" clip-path="url(#covE)" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect x="${PAD}" y="${PAD}" width="${size}" height="${size}" rx="4" fill="${accent}" opacity="0.12"/>
       <text x="${PAD + size / 2}" y="${PAD + size / 2 + 10}" font-size="34" text-anchor="middle" fill="${accent}">♪</text>`;

  const status = live ? 'NOW PLAYING' : 'LAST PLAYED';
  const fillPct = live ? 33 : 0;
  const barY = PAD + size - 14;
  const barW = textLimit;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none" role="img">
  ${defs}
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="${t.radius ?? 10}" fill="${fill}"/>
  ${artwork}
  <text x="${tx}" y="${PAD + 22}" font-family="${F}" font-size="17" font-weight="700" fill="${t.title}">${escapeXML(truncate(song, cap))}</text>
  <text x="${tx}" y="${PAD + 42}" font-family="${F}" font-size="13" fill="${t.subtitle}">${escapeXML(truncate(artist, cap))}</text>
  <text x="${tx}" y="${PAD + 62}" font-family="${F}" font-size="11" font-weight="700" letter-spacing="1" fill="${accent}">${status}</text>
  <rect x="${tx}" y="${barY}" width="${barW}" height="4" rx="2" fill="${t.subtitle}" opacity="0.25"/>
  <rect x="${tx}" y="${barY}" width="${(barW * fillPct) / 100}" height="4" rx="2" fill="${accent}"/>
  <text x="${tx}" y="${barY + 16}" font-family="${F}" font-size="10" fill="${t.subtitle}">0:00</text>
  <text x="${tx + barW}" y="${barY + 16}" text-anchor="end" font-family="${F}" font-size="10" fill="${t.subtitle}">--:--</text>
</svg>`;
}

function render(t: Theme, d: Data): string {
  const { defs, fill } = resolveBackground(t);
  const live = Boolean(d.current['@attr']?.nowplaying);
  const accent = t.accent || '#e5342b';
  const F = t.font || FONT;

  // themes can ask for a wider card so it can sit beside cards of another size
  // without being scaled to a different type size. default stays 500.
  const W = t.width || 500;
  const H = 220;
  const asz = 134;
  const ax = W - 28 - asz;
  const ay = 43;
  const textLimit = ax - 12;

  // how many glyphs fit before the artwork, per size. mono advances at ~0.55em,
  // the sans default a bit under that, so the mono factor covers both.
  const fit = (size: number) => Math.floor((textLimit - 28) / (size * 0.55));
  const cap = {
    title: Math.min(fit(23), 46),
    line: Math.min(fit(14), 68),
    prev: Math.min(fit(15), 46),
    prevLine: Math.min(fit(12), 76),
  };
  const frame = `<rect x="${ax}" y="${ay}" width="${asz}" height="${asz}" rx="14" fill="none" stroke="${t.section}" stroke-opacity="0.35" stroke-width="1.5"/>`;
  const artwork = d.art
    ? `<rect x="${ax - 3}" y="${ay - 3}" width="${asz + 6}" height="${asz + 6}" rx="16" fill="${t.section}" opacity="0.08"/>
       <clipPath id="art"><rect x="${ax}" y="${ay}" width="${asz}" height="${asz}" rx="14"/></clipPath>
       <image href="${d.art}" x="${ax}" y="${ay}" width="${asz}" height="${asz}" clip-path="url(#art)" preserveAspectRatio="xMidYMid slice"/>
       ${frame}`
    : `<rect x="${ax}" y="${ay}" width="${asz}" height="${asz}" rx="14" fill="${t.section}" opacity="0.1"/>
       <text x="${ax + asz / 2}" y="${ay + asz / 2 + 18}" font-size="50" text-anchor="middle" fill="${t.subtitle}">♪</text>
       ${frame}`;

  const header = live
    ? `<circle cx="34" cy="34" r="4" fill="${accent}"><animate attributeName="opacity" values="1;0.2;1" dur="1.3s" repeatCount="indefinite"/></circle>
       <text x="46" y="38" font-family="${F}" font-size="12" font-weight="bold" letter-spacing="2" fill="${accent}">NOW PLAYING</text>
       ${equalizer(accent)}`
    : `<text x="28" y="38" font-family="${F}" font-size="12" font-weight="bold" letter-spacing="2" fill="${t.subtitle}">WAS PLAYING</text>`;

  const previous = d.previous
    ? `<line x1="28" y1="128" x2="${textLimit - 16}" y2="128" stroke="${t.subtitle}" stroke-opacity="0.18"/>
       <text x="28" y="150" font-family="${F}" font-size="10" font-weight="bold" letter-spacing="2" fill="${t.subtitle}">PREVIOUS</text>
       <text x="28" y="172" font-family="${F}" font-size="15" font-weight="bold" fill="${t.section}" opacity="0.9">${escapeXML(truncate(d.previous.name, cap.prev))}</text>
       <text x="28" y="190" font-family="${F}" font-size="12" fill="${t.subtitle}">${escapeXML(line(d.previous.artist?.['#text'], d.previous.album?.['#text'], cap.prevLine))}</text>`
    : '';

  const stats = `${formatNumber(d.artistPlays)} artist plays   ·   ${formatNumber(d.trackPlays)} track plays   ·   ${d.total} scrobbles`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none" role="img">
  ${defs}
  ${t.flat
    ? `<rect width="${W}" height="${H}" fill="${fill}"/>
  ${t.noRules ? '' : `<line x1="${28}" y1="0.5" x2="${W - 28}" y2="0.5" stroke="${t.subtitle}" stroke-opacity="0.3"/>
  <line x1="12" y1="0" x2="12" y2="${H}" stroke="${t.subtitle}" stroke-opacity="0.3" stroke-width="1.5"/>`}`
    : `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="${t.radius ?? 16}" fill="${fill}" stroke="${t.subtitle}" stroke-opacity="0.18"/>`}
  ${artwork}
  ${header}
  <text x="28" y="78" font-family="${F}" font-size="23" font-weight="bold" fill="${t.section}">${escapeXML(truncate(d.current.name, cap.title))}</text>
  <text x="28" y="103" font-family="${F}" font-size="14" fill="${t.item}">${escapeXML(line(d.current.artist?.['#text'], d.current.album?.['#text'], cap.line))}</text>
  ${previous}
  <text x="28" y="209" font-family="${F}" font-size="10.5" fill="${t.subtitle}">${escapeXML(stats)}</text>
</svg>`;
}

function pickRenderer(t: Theme): (t: Theme, d: Data) => string {
  switch (t.render) {
    case 'vertical':
      return (theme, d) => renderSpotifyVertical(theme, d, { bars: true, karaoke: false });
    case 'vertical-compact':
      return (theme, d) => renderSpotifyVertical(theme, d, { bars: false, karaoke: false });
    case 'vertical-karaoke':
      return (theme, d) => renderSpotifyVertical(theme, d, { bars: false, karaoke: true });
    case 'inline':
      return (theme, d) => renderSpotifyInline(theme, d, 64);
    case 'inline-scroll':
      return (theme, d) => renderSpotifyInline(theme, d, 80);
    case 'apple':
      return renderSpotifyApple;
    case 'embed':
      return renderSpotifyEmbed;
    default:
      return (t.width || 500) >= 800 ? renderWide : render;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const theme = getTheme(req.query.theme, req.query.bg, req.query.radius);
  const coverColor = req.query.cover_color === 'true';
  const interchange = req.query.interchange === 'true';
  try {
    const users = parseUsernames(req.query.username);
    if (!users.length) return sendError(res, 'username query param is required', theme);

    // Pull each account's recent tracks + info in parallel; one failing account
    // doesn't sink the card.
    const [recents, infos] = await Promise.all([
      Promise.all(users.map((u) => getRecentTracks(u, 3).catch(() => [] as RecentTrack[]))),
      Promise.all(users.map((u) => getUserInfo(u).catch(() => null))),
    ]);

    // Merge: drop excluded artists, then order nowplaying-first, newest-first.
    const merged = recents
      .flat()
      .filter((t) => t && t.name && !isExcluded(t.artist?.['#text']))
      .sort((a, b) => {
        const an = a['@attr']?.nowplaying ? 1 : 0;
        const bn = b['@attr']?.nowplaying ? 1 : 0;
        if (an !== bn) return bn - an;
        return (Number(b.date?.uts) || 0) - (Number(a.date?.uts) || 0);
      });

    const current = merged[0];
    if (!current) return sendError(res, 'No recent tracks found', theme);
    const previous = merged.find((t) => trackKey(t) !== trackKey(current));

    const artist = current.artist?.['#text'] || '';
    const [artistPlaysArr, trackPlaysArr] = await Promise.all([
      Promise.all(users.map((u) => getArtistPlays(u, artist))),
      Promise.all(users.map((u) => getTrackPlays(u, artist, current.name))),
    ]);

    // prefer Last.fm's own cover, fall back to iTunes if it's missing or dead
    let artUrl = albumArt(current.image);
    let art = await fetchAvatar(artUrl);
    if (!art) {
      artUrl = await itunesArt(artist, current.album?.['#text'], current.name);
      art = artUrl ? await fetchAvatar(artUrl) : null;
    }

    const artistPlays = artistPlaysArr.reduce((a, b) => a + b, 0);
    const trackPlays = trackPlaysArr.reduce((a, b) => a + b, 0);
    const total = infos.reduce((sum, i) => sum + (Number(i?.playcount) || 0), 0);

    const renderTheme = coverColor
      ? { ...theme, accent: ensureContrast((await dominantColor(artUrl)) || theme.accent || theme.section) }
      : theme;

    const renderCurrent = interchange
      ? { ...current, name: artist || current.name, artist: { ...current.artist, '#text': current.name } }
      : current;

    const data = { current: renderCurrent, previous, art, artistPlays, trackPlays, total: formatNumber(total) };
    const draw = pickRenderer(renderTheme);
    sendSvg(res, draw(renderTheme, data), 30);
  } catch (err) {
    sendError(res, err instanceof LastfmError ? err.message : 'Error fetching data from Last.fm', theme);
  }
}
