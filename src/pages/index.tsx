import { useEffect, useMemo, useState } from "react";
import Head from "next/head";

const ENDPOINTS = [
  { id: "now-playing", label: "Now Playing", needsPeriod: false, multiUser: true, desc: "Currently (or most recently) playing track. Give a comma-separated list of usernames to merge multiple accounts into one card." },
  { id: "recent", label: "Recent Tracks", needsPeriod: false, multiUser: false, desc: "Last 5 scrobbled tracks." },
  { id: "overall", label: "Full Stats", needsPeriod: true, multiUser: false, desc: "Top artists, tracks, albums, and recent tracks in a single card." },
  { id: "top-artists", label: "Top Artists", needsPeriod: true, multiUser: false, desc: "Top 5 artists for the period." },
  { id: "top-tracks", label: "Top Tracks", needsPeriod: true, multiUser: false, desc: "Top 5 tracks for the period." },
  { id: "top-albums", label: "Top Albums", needsPeriod: true, multiUser: false, desc: "Top 5 albums for the period." },
] as const;
type EndpointId = (typeof ENDPOINTS)[number]["id"];

const THEMES = ["default", "dark", "light", "arsh", "arsh-light", "git", "git-light", "dracula", "gruvbox", "tokyonight", "radical", "nord", "catppuccin"];

const PERIODS = [
  { value: "overall", label: "Overall" },
  { value: "7day", label: "7 days" },
  { value: "1month", label: "1 month" },
  { value: "3month", label: "3 months" },
  { value: "6month", label: "6 months" },
  { value: "12month", label: "12 months" },
];

const inputStyle: React.CSSProperties = {
  width: "100%",
  borderRadius: 8,
  border: "1px solid #2c2c39",
  background: "#12121a",
  color: "#e8e8ec",
  padding: "8px 10px",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  fontSize: 14,
  outline: "none",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  color: "#9a9aa8",
  marginBottom: 4,
};

export default function Home() {
  // matches the SSR-rendered production URL until mount, then swaps to
  // whatever port the dev server actually runs on - avoids hardcoding a port
  // that only holds for one particular local setup
  const [ORIGIN_URL, setOriginUrl] = useState("https://lastly.arshnah.in");
  useEffect(() => {
    if (window.location.hostname === "localhost") setOriginUrl(window.location.origin);
  }, []);

  const [endpoint, setEndpoint] = useState<EndpointId>("now-playing");
  const [username, setUsername] = useState("");
  const [theme, setTheme] = useState("git");
  const [bg, setBg] = useState("");
  const [period, setPeriod] = useState("overall");
  const [outputType, setOutputType] = useState<"markdown" | "html" | "url">("markdown");
  const [copyState, setCopyState] = useState("Copy");

  const meta = ENDPOINTS.find((e) => e.id === endpoint)!;

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (username) params.set("username", username);
    params.set("theme", theme);
    if (/^[0-9a-fA-F]{3,8}$/.test(bg)) params.set("bg", bg);
    if (meta.needsPeriod) params.set("period", period);
    const qs = params.toString();
    return `${ORIGIN_URL}/api/${endpoint}${qs ? `?${qs}` : ""}`;
  }, [ORIGIN_URL, endpoint, username, theme, bg, period, meta.needsPeriod]);

  const copyContent = {
    markdown: `![Last.fm ${meta.label}](${url})`,
    html: `<img src="${url}" alt="Last.fm ${meta.label}" />`,
    url,
  };

  return (
    <>
      <Head>
        <title>lastly — Last.fm stats cards</title>
      </Head>
      <main
        style={{
          minHeight: "100vh",
          background: "#0a0a12",
          color: "#e8e8ec",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          padding: "48px 16px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 24,
        }}
      >
        <div style={{ width: "100%", maxWidth: 640 }}>
          <p style={{ fontSize: 28, fontWeight: 600, margin: "0 0 6px" }}>&#127925; lastly</p>
          <p style={{ color: "#9a9aa8", fontSize: 14, margin: "0 0 20px" }}>
            Last.fm stats as an embeddable SVG card, for a GitHub README or anywhere else that takes an image URL.
          </p>

          {!username ? (
            <div
              style={{
                width: "100%",
                minHeight: 180,
                borderRadius: 12,
                border: "1px solid #25252f",
                background: "rgba(255,255,255,0.03)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "rgba(232,232,236,0.3)",
                fontSize: 14,
                textAlign: "center",
                padding: "0 40px",
                marginBottom: 20,
              }}
            >
              Enter a Last.fm username to preview the card
            </div>
          ) : (
            <img
              src={url}
              alt="preview"
              style={{ maxWidth: "100%", display: "block", margin: "0 auto 20px" }}
            />
          )}

          <div
            style={{
              border: "1px solid #25252f",
              background: "rgba(255,255,255,0.02)",
              borderRadius: 12,
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            <div>
              <label style={labelStyle}>Card</label>
              <select
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value as EndpointId)}
                style={inputStyle}
              >
                {ENDPOINTS.map((e) => (
                  <option key={e.id} value={e.id} style={{ background: "#12121a" }}>
                    {e.label}
                  </option>
                ))}
              </select>
              <p style={{ fontSize: 12, color: "#82828d", margin: "6px 0 0" }}>{meta.desc}</p>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: meta.needsPeriod ? "1fr 1fr 1fr" : "1fr 1fr",
                gap: 10,
              }}
            >
              <div>
                <label style={labelStyle}>
                  Username{meta.multiUser ? " (or a,b to merge)" : ""}
                </label>
                <input
                  style={inputStyle}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="your-lastfm-username"
                />
              </div>

              <div>
                <label style={labelStyle}>Theme</label>
                <select value={theme} onChange={(e) => setTheme(e.target.value)} style={inputStyle}>
                  {THEMES.map((t) => (
                    <option key={t} value={t} style={{ background: "#12121a" }}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              {meta.needsPeriod && (
                <div>
                  <label style={labelStyle}>Period</label>
                  <select value={period} onChange={(e) => setPeriod(e.target.value)} style={inputStyle}>
                    {PERIODS.map((p) => (
                      <option key={p.value} value={p.value} style={{ background: "#12121a" }}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div>
              <label style={labelStyle}>Background Color (hex, optional)</label>
              <input
                style={inputStyle}
                value={bg}
                onChange={(e) => setBg(e.target.value.replace(/^#/, ""))}
                placeholder="1a2a3a"
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
              {(["markdown", "html", "url"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setOutputType(t)}
                  style={{
                    borderRadius: 6,
                    border: `1px solid ${outputType === t ? "rgba(255,255,255,0.3)" : "#25252f"}`,
                    background: outputType === t ? "#1c1c26" : "transparent",
                    color: outputType === t ? "#e8e8ec" : "#82828d",
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                    fontSize: 12,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    padding: "6px 0",
                    cursor: "pointer",
                  }}
                >
                  {t}
                </button>
              ))}
            </div>

            <div
              style={{
                border: "1px solid #2c2c39",
                background: "#12121a",
                borderRadius: 8,
                padding: "10px 12px",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                fontSize: 13,
                color: "#8fb6ff",
                wordBreak: "break-all",
              }}
            >
              {copyContent[outputType]}
            </div>

            <button
              onClick={() => {
                navigator.clipboard.writeText(copyContent[outputType]);
                setCopyState("Copied!");
                setTimeout(() => setCopyState("Copy"), 1500);
              }}
              style={{
                width: "100%",
                borderRadius: 8,
                border: "1px solid #25252f",
                background: "#14141d",
                color: "#9a9aa8",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                fontSize: 13,
                fontWeight: 600,
                padding: "8px 0",
                cursor: "pointer",
              }}
            >
              {copyState}
            </button>
          </div>

          <p style={{ fontSize: 12, color: "#82828d", marginTop: 16 }}>
            Source on{" "}
            <a href="https://github.com/arshnah/lastly" style={{ color: "#8fb6ff" }}>
              GitHub
            </a>
            .
          </p>
        </div>
      </main>
    </>
  );
}
