# Lastly

Lastly generates dynamic SVG cards of your Last.fm listening stats, built to embed straight into a GitHub README or any markdown page. Everything renders server-side as an SVG, with CDN caching and a set of color themes.

It covers a live now-playing card, overall stats, top artists, tracks and albums, and recent activity. Any Last.fm user works.

> Forked from [ni5arga/Lastly](https://github.com/ni5arga/lastly) (MIT). This fork adds the now-playing card, multi-account merging, the `arsh`/`arsh-light` and `git`/`git-light` themes, and a `bg` color override. Deployed at [lastly.arshnah.in](https://lastly.arshnah.in), which also has a homepage that builds the URL for you - pick a card, a username, a theme, and copy the markdown/HTML/URL out.

## API endpoints

| Endpoint           | Description                                              |
| ------------------ | ------------------------------------------------------- |
| `/api/now-playing` | Live now-playing or last scrobble, with play counts     |
| `/api/overall`     | Overall listening statistics                            |
| `/api/top-artists` | Top artists                                             |
| `/api/top-tracks`  | Top tracks                                               |
| `/api/top-albums`  | Top albums                                               |
| `/api/recent`      | Recently played                                         |
| `/api/lyrics`      | Lyrics for the current/last track, via lrclib.net        |

## Embedding

Markdown:

```
![Now Playing](https://lastly.arshnah.in/api/now-playing?username=USERNAME&theme=arsh)
```

Or HTML for more control (e.g. centering):

```
<img src="https://lastly.arshnah.in/api/overall?username=USERNAME&theme=dracula" alt="Overall Statistics" align="center">
```

Replace `USERNAME` with your Last.fm username.

### Query options

- **`username`** *(required)*: your [Last.fm](https://www.last.fm) username. On `now-playing` you can pass more than one, comma-separated, to merge accounts (see below).
- **`period`**: time range for stats. Applies to `overall`, `top-artists`, `top-tracks`, `top-albums`.
  - `overall` (default), `7day`, `1month`, `3month`, `6month`, `12month`
- **`theme`**: color theme. Defaults to `default`.
  - `default`, `dark`, `light`, `arsh`, `arsh-light`, `git`, `git-light`, `dracula`, `gruvbox`, `tokyonight`, `radical`, `nord`, `catppuccin`
  - `now-playing` only also has `spotify`, `spotify-compact`, `spotify-karaoke`, `spotify-inline`, `spotify-novatorem`, `spotify-apple`, `spotify-apple-light`, `spotify-embed`, `spotify-embed-light`, layouts inspired by [spotify-github-profile](https://github.com/kittinan/spotify-github-profile)
- **`bg`**: hex color (no `#`) to override the theme's background, e.g. `bg=1a2a3a`. Invalid values are ignored.
- **`radius`**: corner radius in pixels (0-40), e.g. `radius=0` for square corners. Works on every card.
- **`cover_color`** *(now-playing only)*: `true` picks the accent/equalizer color from the current track's cover art instead of the theme default.
- **`interchange`** *(now-playing only)*: `true` swaps which line is the bold headline, artist instead of track name.

Invalid values fall back to defaults.

### Now playing, with account merging

`/api/now-playing` shows what you are playing right now, or your last scrobble if nothing is live, plus artist and track play counts and your total scrobbles.

Pass several usernames, comma-separated, to merge accounts into one card. It shows whichever account is currently playing, or the most recent scrobble across all of them, and sums the play counts and totals:

```
![Now Playing](https://lastly.arshnah.in/api/now-playing?username=account_one,account_two&theme=arsh)
```

Set `LASTFM_EXCLUDE_ARTISTS` (comma-separated, substring match) to skip artists when picking the current track. Useful for hiding something that auto-plays.

## Caching

Responses are served with `Cache-Control` headers so the CDN can serve cards without re-hitting Last.fm on every render:

- `overall`, `top-*` are cached ~6 hours
- `recent` and `now-playing` are cached ~30 seconds, since they change often

Errors (e.g. unknown user) return a readable SVG error card with a short cache, so your README never shows a broken image.

## Self-hosting

1. **Clone the repository**:

```
git clone https://github.com/arshnah/lastly.git
cd lastly
```

2. **Install dependencies**:

```
npm install
```

3. **Configure environment**: create a `.env.local` in the root:

```
LASTFM_API_KEY=your_lastfm_api_key
LASTFM_EXCLUDE_ARTISTS=Some Artist   # optional, comma-separated
```

4. **Run the development server**:

```
npm run dev
```

Open <http://localhost:3000> with your browser to view the project.

## Deploy with Vercel

Deploy to Vercel and set the `LASTFM_API_KEY` environment variable during setup.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Farshnah%2Flastly&env=LASTFM_API_KEY)

## Project structure

```
src/
├── lib/
│   ├── lastfm.ts   # Last.fm API client: typed fetchers, parseUsernames, timeouts, avatar handling
│   └── svg.ts      # Themes (incl. arsh/arsh-light, git/git-light), bg override, SVG building blocks, error cards, cached senders
└── pages/
    ├── _app.tsx    # loads Space Grotesk + JetBrains Mono, per grain's spine rule
    ├── index.tsx   # the homepage - builds the URL, live preview, markdown/HTML/URL copy tabs
    └── api/
        ├── now-playing.ts   # live card, merges multiple accounts
        ├── overall.ts
        ├── recent.ts
        ├── top-albums.ts
        ├── top-artists.ts
        └── top-tracks.ts
```

## License

MIT, see the [LICENSE](LICENSE) file. Forked from [ni5arga/Lastly](https://github.com/ni5arga/lastly).
