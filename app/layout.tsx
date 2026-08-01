import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "./Nav";
import { AdminMode } from "./AdminMode";

export const metadata: Metadata = {
  title: "newsfeed",
  description: "A calm, chronological RSS reader.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Nav />
        <AdminMode />
        {children}
      </body>
    </html>
  );
}
