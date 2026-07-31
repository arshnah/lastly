import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";

// grain spine rule: every arshnah surface pairs Space Grotesk (display) with
// JetBrains Mono (the machine voice) - see project-notes/grain.md
const spaceGrotesk = Space_Grotesk({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-space-grotesk",
});

const jetbrainsMono = JetBrains_Mono({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains-mono",
});

export default function App({ Component, pageProps }: AppProps) {
  return (
    <div className={`${spaceGrotesk.variable} ${jetbrainsMono.variable}`}>
      <Component {...pageProps} />
    </div>
  );
}
