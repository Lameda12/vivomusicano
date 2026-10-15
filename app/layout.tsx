import type { Metadata, Viewport } from "next";
import { Anton, JetBrains_Mono } from "next/font/google";
import { APP_DESCRIPTION, APP_NAME, APP_TAGLINE } from "@/lib/brand";
import "./globals.css";

const display = Anton({ variable: "--font-anton", weight: "400", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });

// Absolute base for og:image URLs. Set NEXT_PUBLIC_SITE_URL for a custom domain; Vercel's production URL otherwise.
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: `${APP_NAME} — gesture synth`,
  description: APP_DESCRIPTION,
  openGraph: { title: `${APP_NAME} — ${APP_TAGLINE}`, description: APP_DESCRIPTION, siteName: APP_NAME, type: "website" },
  twitter: { card: "summary_large_image", title: `${APP_NAME} — ${APP_TAGLINE}`, description: APP_DESCRIPTION },
};

export const viewport: Viewport = { themeColor: "#07070a" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable} h-full antialiased`}>
      <body className="h-full overflow-hidden bg-stage">{children}</body>
    </html>
  );
}
