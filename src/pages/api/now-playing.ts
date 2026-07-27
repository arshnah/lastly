import type { NextApiRequest, NextApiResponse } from 'next';
import { getTheme, escapeXML, truncate, formatNumber, FONT, resolveBackground, sendError, sendSvg, Theme } from '@/lib/svg';
import {
  parseUsernames,
  getUserInfo,
  getRecentTracks,
  getArtistPlays,
  getTrackPlays,
  fetchAvatar,
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
  const head = live ? 'now playing' : 'last scrobble';
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
    : `<text x="28" y="38" font-family="${F}" font-size="12" font-weight="bold" letter-spacing="2" fill="${t.subtitle}">LAST SCROBBLE</text>`;

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
  <line x1="${28}" y1="0.5" x2="${W - 28}" y2="0.5" stroke="${t.subtitle}" stroke-opacity="0.3"/>
  <line x1="12" y1="0" x2="12" y2="${H}" stroke="${t.subtitle}" stroke-opacity="0.3" stroke-width="1.5"/>`
    : `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="16" fill="${fill}" stroke="${t.subtitle}" stroke-opacity="0.18"/>`}
  ${artwork}
  ${header}
  <text x="28" y="78" font-family="${F}" font-size="23" font-weight="bold" fill="${t.section}">${escapeXML(truncate(d.current.name, cap.title))}</text>
  <text x="28" y="103" font-family="${F}" font-size="14" fill="${t.item}">${escapeXML(line(d.current.artist?.['#text'], d.current.album?.['#text'], cap.line))}</text>
  ${previous}
  <text x="28" y="209" font-family="${F}" font-size="10.5" fill="${t.subtitle}">${escapeXML(stats)}</text>
</svg>`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const theme = getTheme(req.query.theme);
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
    let art = await fetchAvatar(albumArt(current.image));
    if (!art) {
      const alt = await itunesArt(artist, current.album?.['#text'], current.name);
      if (alt) art = await fetchAvatar(alt);
    }

    const artistPlays = artistPlaysArr.reduce((a, b) => a + b, 0);
    const trackPlays = trackPlaysArr.reduce((a, b) => a + b, 0);
    const total = infos.reduce((sum, i) => sum + (Number(i?.playcount) || 0), 0);

    const data = { current, previous, art, artistPlays, trackPlays, total: formatNumber(total) };
    const draw = (theme.width || 500) >= 800 ? renderWide : render;
    sendSvg(res, draw(theme, data), 30);
  } catch (err) {
    sendError(res, err instanceof LastfmError ? err.message : 'Error fetching data from Last.fm', theme);
  }
}
