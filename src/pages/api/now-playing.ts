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

function textCap(widthPx: number, fontPx: number, weight: 'regular' | 'bold' | 'heavy' = 'regular'): number {
  const factor = weight === 'heavy' ? 0.66 : weight === 'bold' ? 0.6 : 0.52;
  return Math.max(3, Math.floor(widthPx / (fontPx * factor)));
}

function clip(id: string, x: number, y: number, width: number, height: number): { def: string; attr: string } {
  return {
    def: `<clipPath id="${id}"><rect x="${x}" y="${y}" width="${Math.max(0, width)}" height="${height}"/></clipPath>`,
    attr: ` clip-path="url(#${id})"`,
  };
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
  const textWidth = coverSize - 20;
  const textX = PAD + 10;

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
    const cap = textCap(textWidth, 22, 'heavy');
    const songClip = clip('kSong', textX, y - 4, textWidth, 30);
    const artistClip = clip('kArtist', textX, y + 24, textWidth, 30);
    textBlock = `${songClip.def}${artistClip.def}
      <text x="${W / 2}" y="${y + 20}" text-anchor="middle" font-family="${F}" font-size="22" font-weight="900" fill="#0000de" stroke="#f7f7f7" stroke-width="0.6"${songClip.attr}>${escapeXML(truncate(song, cap))}</text>
      <text x="${W / 2}" y="${y + 48}" text-anchor="middle" font-family="${F}" font-size="22" font-weight="900" fill="#ff3333" stroke="#efefef" stroke-width="0.6"${artistClip.attr}>${escapeXML(truncate(artist, cap))}</text>`;
    y += 64;
  } else {
    const artistCap = textCap(textWidth, 19, 'bold');
    const songCap = textCap(textWidth, 15, 'regular');
    const artistClip = clip('vArtist', textX, y - 4, textWidth, 26);
    const songClip = clip('vSong', textX, y + 18, textWidth, 24);
    textBlock = `${artistClip.def}${songClip.def}
      <text x="${W / 2}" y="${y + 18}" text-anchor="middle" font-family="${F}" font-size="19" font-weight="bold" fill="${t.title}"${artistClip.attr}>${escapeXML(truncate(artist, artistCap))}</text>
      <text x="${W / 2}" y="${y + 40}" text-anchor="middle" font-family="${F}" font-size="15" fill="${t.subtitle}"${songClip.attr}>${escapeXML(truncate(song, songCap))}</text>`;
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
  const textLimit = W - PAD - tx;
  const artistCap = textCap(textLimit, 15, 'bold');
  const songCap = textCap(textLimit, 13, 'regular');
  const artistClip = clip('inArtist', tx, PAD, textLimit, 22);
  const songClip = clip('inSong', tx, PAD + 22, textLimit, 20);

  const artwork = d.art
    ? `<clipPath id="cov2"><rect x="${PAD}" y="${PAD}" width="${size}" height="${size}" rx="4"/></clipPath>
       <image href="${d.art}" x="${PAD}" y="${PAD}" width="${size}" height="${size}" clip-path="url(#cov2)" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect x="${PAD}" y="${PAD}" width="${size}" height="${size}" rx="4" fill="${accent}" opacity="0.12"/>
       <text x="${PAD + size / 2}" y="${PAD + size / 2 + 8}" font-size="24" text-anchor="middle" fill="${t.subtitle}">♪</text>`;

  const bars = live ? miniEqualizer(tx, PAD + size - 6, accent) : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none" role="img">
  ${defs}
  ${artistClip.def}${songClip.def}
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="${t.flat ? 0 : t.radius ?? 10}" fill="${fill}"${t.flat ? '' : ` stroke="${t.subtitle}" stroke-opacity="0.18"`}/>
  ${artwork}
  <text x="${tx}" y="${PAD + 18}" font-family="${F}" font-size="15" font-weight="600" fill="${t.title}"${artistClip.attr}>${escapeXML(truncate(artist, artistCap))}</text>
  <text x="${tx}" y="${PAD + 38}" font-family="${F}" font-size="13" fill="${t.subtitle}"${songClip.attr}>${escapeXML(truncate(song, songCap))}</text>
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
  const songCap = textCap(coverSize, 18, 'bold');
  const artistCap = textCap(coverSize, 15, 'regular');

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
  const songClip = clip('appleSong', PAD, ty - 20, coverSize, 26);
  const artistClip = clip('appleArtist', PAD, ty + 2, coverSize, 22);
  const songLine = `${songClip.def}<text x="${PAD}" y="${ty}" font-family="${F}" font-size="18" font-weight="700" fill="${t.title}"${songClip.attr}>${escapeXML(truncate(song, songCap))}</text>`;
  const artistLine = `${artistClip.def}<text x="${PAD}" y="${ty + 22}" font-family="${F}" font-size="15" fill="${t.subtitle}"${artistClip.attr}>${escapeXML(truncate(artist, artistCap))}</text>`;

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
  const songCap = textCap(textLimit, 17, 'bold');
  const artistCap = textCap(textLimit, 13, 'regular');
  const songClip = clip('embedSong', tx, PAD, textLimit, 24);
  const artistClip = clip('embedArtist', tx, PAD + 24, textLimit, 20);

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
  ${songClip.def}${artistClip.def}
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="${t.radius ?? 10}" fill="${fill}"/>
  ${artwork}
  <text x="${tx}" y="${PAD + 22}" font-family="${F}" font-size="17" font-weight="700" fill="${t.title}"${songClip.attr}>${escapeXML(truncate(song, songCap))}</text>
  <text x="${tx}" y="${PAD + 42}" font-family="${F}" font-size="13" fill="${t.subtitle}"${artistClip.attr}>${escapeXML(truncate(artist, artistCap))}</text>
  <text x="${tx}" y="${PAD + 62}" font-family="${F}" font-size="11" font-weight="700" letter-spacing="1" fill="${accent}">${status}</text>
  <rect x="${tx}" y="${barY}" width="${barW}" height="4" rx="2" fill="${t.subtitle}" opacity="0.25"/>
  <rect x="${tx}" y="${barY}" width="${(barW * fillPct) / 100}" height="4" rx="2" fill="${accent}"/>
  <text x="${tx}" y="${barY + 16}" font-family="${F}" font-size="10" fill="${t.subtitle}">0:00</text>
  <text x="${tx + barW}" y="${barY + 16}" text-anchor="end" font-family="${F}" font-size="10" fill="${t.subtitle}">--:--</text>
</svg>`;
}

function renderGit(t: Theme, d: Data): string {
  const { defs, fill } = resolveBackground(t);
  const live = Boolean(d.current['@attr']?.nowplaying);
  const accent = t.accent || t.section;
  const F = t.font || FONT;
  const W = t.width || 500;
  const H = 122;
  const PAD = 20;
  const asz = 84;
  const ax = W - PAD - asz;
  const ay = (H - asz) / 2;
  const textLimit = ax - PAD - 14;

  const artist = d.current.artist?.['#text'] || 'Unknown Artist';
  const song = d.current.name;
  const titleCap = textCap(textLimit, 16, 'bold');
  const artistCap = textCap(textLimit, 12.5, 'regular');
  const footerCap = textCap(textLimit, 10.5, 'regular');
  const titleClip = clip('gitTitle', PAD, 30, textLimit, 24);
  const artistClip = clip('gitArtist', PAD, 52, textLimit, 20);
  const footerClip = clip('gitFooter', PAD, 84, textLimit, 18);

  const artwork = d.art
    ? `<clipPath id="gitArt"><rect x="${ax}" y="${ay}" width="${asz}" height="${asz}" rx="8"/></clipPath>
       <image href="${d.art}" x="${ax}" y="${ay}" width="${asz}" height="${asz}" clip-path="url(#gitArt)" preserveAspectRatio="xMidYMid slice"/>
       <rect x="${ax}" y="${ay}" width="${asz}" height="${asz}" rx="8" fill="none" stroke="${t.subtitle}" stroke-opacity="0.3"/>`
    : `<rect x="${ax}" y="${ay}" width="${asz}" height="${asz}" rx="8" fill="${accent}" opacity="0.1"/>
       <text x="${ax + asz / 2}" y="${ay + asz / 2 + 8}" font-size="28" text-anchor="middle" fill="${t.subtitle}">♪</text>`;

  const badgeLabel = live ? 'NOW PLAYING' : 'RECENTLY PLAYED';
  const badgeColor = live ? accent : t.subtitle;
  const header = `<circle cx="${PAD + 4}" cy="17" r="3.5" fill="${badgeColor}">${live ? `<animate attributeName="opacity" values="1;0.25;1" dur="1.3s" repeatCount="indefinite"/>` : ''}</circle>
       <text x="${PAD + 14}" y="20.5" font-family="${F}" font-size="10" font-weight="700" letter-spacing="1.5" fill="${badgeColor}">${badgeLabel}</text>`;

  const footerText = d.previous
    ? `Previously: ${d.previous.name} — ${formatNumber(d.artistPlays)} artist plays · ${formatNumber(d.trackPlays)} track plays`
    : `${formatNumber(d.artistPlays)} artist plays · ${formatNumber(d.trackPlays)} track plays · ${d.total} scrobbles`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none" role="img">
  ${defs}
  ${titleClip.def}${artistClip.def}${footerClip.def}
  <rect width="${W}" height="${H}" fill="${fill}"/>
  <line x1="0" y1="0.5" x2="${W}" y2="0.5" stroke="${t.subtitle}" stroke-opacity="0.3"/>
  <line x1="0" y1="${H - 0.5}" x2="${W}" y2="${H - 0.5}" stroke="${t.subtitle}" stroke-opacity="0.3"/>
  ${header}
  <text x="${PAD}" y="46" font-family="${F}" font-size="16" font-weight="700" fill="${t.title}"${titleClip.attr}>${escapeXML(truncate(song, titleCap))}</text>
  <text x="${PAD}" y="66" font-family="${F}" font-size="12.5" fill="${t.subtitle}"${artistClip.attr}>${escapeXML(truncate(artist, artistCap))}</text>
  <text x="${PAD}" y="98" font-family="${F}" font-size="10.5" fill="${t.subtitle}"${footerClip.attr}>${escapeXML(truncate(footerText, footerCap))}</text>
  ${artwork}
</svg>`;
}

function render(t: Theme, d: Data): string {
  const { defs, fill } = resolveBackground(t);
  const live = Boolean(d.current['@attr']?.nowplaying);
  const accent = t.accent || '#e5342b';
  const F = t.font || FONT;
  const hasArt = Boolean(d.art);

  // themes can ask for a wider card so it can sit beside cards of another size
  // without being scaled to a different type size. default stays 500.
  const W = t.width || 500;
  const H = 280;
  const PAD = 28;
  const radius = t.radius ?? 16;
  const textWidth = W - PAD * 2;

  // full-bleed art needs light text with a bottom scrim for guaranteed
  // contrast; without art, fall back to the theme's own text colors
  const titleColor = hasArt ? '#ffffff' : t.section;
  const itemColor = hasArt ? '#e7e7e7' : t.item;
  const subtleColor = hasArt ? '#c7c7c7' : t.subtitle;

  const cardClip = `<clipPath id="cardClip"><rect x="0" y="0" width="${W}" height="${H}" rx="${radius}"/></clipPath>`;
  const scrim = `<linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="42%" stop-color="#000000" stop-opacity="0.1"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.92"/>
    </linearGradient>`;

  const background = hasArt
    ? `<g clip-path="url(#cardClip)">
         <image href="${d.art}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>
         <rect width="${W}" height="${H}" fill="url(#scrim)"/>
       </g>
       <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="${radius}" fill="none" stroke="#000000" stroke-opacity="0.25"/>`
    : `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="${radius}" fill="${fill}" stroke="${t.subtitle}" stroke-opacity="0.18"/>`;

  const badgeLabel = live ? 'NOW PLAYING' : 'WAS PLAYING';
  const badgeTextColor = hasArt ? accent : live ? accent : t.subtitle;
  const badgeWidth = badgeLabel.length * 6.6 + (live ? 32 : 16);
  const header = `<rect x="${PAD}" y="20" width="${badgeWidth}" height="21" rx="6" fill="${hasArt ? '#000000' : badgeTextColor}" opacity="${hasArt ? 0.45 : 0.14}"/>
       ${live ? `<circle cx="${PAD + 14}" cy="30.5" r="4" fill="${accent}"><animate attributeName="opacity" values="1;0.25;1" dur="1.3s" repeatCount="indefinite"/></circle>` : ''}
       <text x="${PAD + (live ? 24 : 12)}" y="34.5" font-family="${F}" font-size="11" font-weight="700" letter-spacing="1.5" fill="${badgeTextColor}">${escapeXML(badgeLabel)}</text>
       ${live ? miniEqualizer(PAD + badgeWidth + 14, 30, accent) : ''}`;

  const titleCap = textCap(textWidth, 24, 'bold');
  const lineCap = textCap(textWidth, 14, 'regular');
  const titleClip = clip('cTitle', PAD, H - 116, textWidth, 32);
  const lineClip = clip('cLine', PAD, H - 84, textWidth, 22);

  const previousCap = textCap(textWidth, 11.5, 'regular');
  const previousText = d.previous
    ? `Previously — ${d.previous.name} · ${d.previous.artist?.['#text'] || ''}`
    : '';
  const previousClip = clip('cPrev', PAD, H - 58, textWidth, 18);
  const previous = d.previous
    ? `${previousClip.def}<text x="${PAD}" y="${H - 44}" font-family="${F}" font-size="11.5" fill="${subtleColor}"${previousClip.attr}>${escapeXML(truncate(previousText, previousCap))}</text>`
    : '';

  const stats = `${formatNumber(d.artistPlays)} artist plays   ·   ${formatNumber(d.trackPlays)} track plays   ·   ${d.total} scrobbles`;
  const statsCap = textCap(textWidth, 10.5, 'regular');
  const statsClip = clip('cStats', PAD, H - 32, textWidth, 16);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none" role="img">
  ${defs}
  ${cardClip}
  ${hasArt ? scrim : ''}
  ${titleClip.def}${lineClip.def}${statsClip.def}
  ${background}
  ${header}
  <text x="${PAD}" y="${H - 90}" font-family="${F}" font-size="24" font-weight="bold" fill="${titleColor}"${titleClip.attr}>${escapeXML(truncate(d.current.name, titleCap))}</text>
  <text x="${PAD}" y="${H - 66}" font-family="${F}" font-size="14" fill="${itemColor}"${lineClip.attr}>${escapeXML(line(d.current.artist?.['#text'], d.current.album?.['#text'], lineCap))}</text>
  ${previous}
  <text x="${PAD}" y="${H - 20}" font-family="${F}" font-size="10.5" fill="${subtleColor}"${statsClip.attr}>${escapeXML(truncate(stats, statsCap))}</text>
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
    case 'git':
      return renderGit;
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
