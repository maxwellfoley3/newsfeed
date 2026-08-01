import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "./Nav";
import { AdminModeProvider } from "./AdminMode";

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
        <AdminModeProvider>
          <Nav />
          {children}
        </AdminModeProvider>
      </body>
    </html>
  );
}
