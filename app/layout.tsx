import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Following — newsfeed",
  description: "A calm, chronological RSS reader.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
