import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ads Marketplace Simulator",
  description: "Candidate generation, ranking, second-price auctions, and budget pacing over a six-hour session.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body>{children}</body>
    </html>
  );
}
