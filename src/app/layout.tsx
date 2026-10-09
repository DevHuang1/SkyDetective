import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SkyDetective — Celestial Cockpit",
  description:
    "Explore the celestial sphere from an immersive spaceship cockpit viewport.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
