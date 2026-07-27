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

    sendSvg(res, render(theme, { current, previous, art, artistPlays, trackPlays, total: formatNumber(total) }), 30);
  } catch (err) {
    sendError(res, err instanceof LastfmError ? err.message : 'Error fetching data from Last.fm', theme);
  }
}
