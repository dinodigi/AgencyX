import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav.tsx";

export const metadata: Metadata = {
  title: "Lead Engine",
  description: "Agency lead pipeline — scrape, qualify, build, propose, sell.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <div className="flex min-h-screen">
          <Nav />
          <main className="flex-1 min-w-0">{children}</main>
        </div>
      </body>
    </html>
  );
}
