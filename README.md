# Lastly

Lastly generates dynamic SVG cards of your Last.fm listening stats, built to embed straight into a GitHub README or any markdown page. Everything renders server-side as an SVG, with CDN caching and a set of color themes.

It covers a live now-playing card, overall stats, top artists, tracks and albums, and recent activity. Any Last.fm user works.

> Forked from [ni5arga/Lastly](https://github.com/ni5arga/lastly) (MIT). This fork adds the now-playing card, multi-account merging, and the `arsh` / `arsh-light` themes. Deployed at `lastly-pi.vercel.app`.

## API endpoints

| Endpoint           | Description                                              |
| ------------------ | ------------------------------------------------------- |
| `/api/now-playing` | Live now-playing or last scrobble, with play counts     |
| `/api/overall`     | Overall listening statistics                            |
| `/api/top-artists` | Top artists                                             |
| `/api/top-tracks`  | Top tracks                                               |
| `/api/top-albums`  | Top albums                                               |
| `/api/recent`      | Recently played                                         |

## Embedding

Markdown:

```
![Now Playing](https://lastly-pi.vercel.app/api/now-playing?username=USERNAME&theme=arsh)
```

Or HTML for more control (e.g. centering):

```
<img src="https://lastly-pi.vercel.app/api/overall?username=USERNAME&theme=dracula" alt="Overall Statistics" align="center">
```

Replace `USERNAME` with your Last.fm username.

### Query options

- **`username`** *(required)*: your [Last.fm](https://www.last.fm) username. On `now-playing` you can pass more than one, comma-separated, to merge accounts (see below).
- **`period`**: time range for stats. Applies to `overall`, `top-artists`, `top-tracks`, `top-albums`.
  - `overall` (default), `7day`, `1month`, `3month`, `6month`, `12month`
- **`theme`**: color theme. Defaults to `default`.
  - `default`, `dark`, `light`, `arsh`, `arsh-light`, `dracula`, `gruvbox`, `tokyonight`, `radical`, `nord`, `catppuccin`

Invalid values fall back to defaults.

### Now playing, with account merging

`/api/now-playing` shows what you are playing right now, or your last scrobble if nothing is live, plus artist and track play counts and your total scrobbles.

Pass several usernames, comma-separated, to merge accounts into one card. It shows whichever account is currently playing, or the most recent scrobble across all of them, and sums the play counts and totals:

```
![Now Playing](https://lastly-pi.vercel.app/api/now-playing?username=account_one,account_two&theme=arsh)
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
│   └── svg.ts      # Themes (incl. arsh / arsh-light), SVG building blocks, error cards, cached senders
└── pages/
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
