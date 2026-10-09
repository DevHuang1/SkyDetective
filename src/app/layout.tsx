import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SkyDetective — SPHEREx Sky Atlas",
  description:
    "Browse real sky surveys from a spaceship cockpit and compare SPHEREx observations across dates.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
