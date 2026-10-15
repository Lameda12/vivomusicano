import type { Metadata, Viewport } from "next";
import { Anton, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const display = Anton({ variable: "--font-anton", weight: "400", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "VIVO — gesture synth",
  description: "Play along with a singer: hand gestures advance a preloaded chord progression and shape its sound.",
};

export const viewport: Viewport = { themeColor: "#07070a" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable} h-full antialiased`}>
      <body className="h-full overflow-hidden bg-stage">{children}</body>
    </html>
  );
}
