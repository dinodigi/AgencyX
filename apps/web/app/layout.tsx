import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import { Nav } from "@/components/Nav.tsx";

export const metadata: Metadata = {
  title: "Lead Engine",
  description: "Agency lead pipeline — scrape, qualify, build, propose, sell.",
};

// The app is inherently per-request (org-scoped auth) — nothing to prerender.
// This also keeps ClerkProvider out of static generation of /_not-found.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: ReactNode }) {
  const shell = (
    <html lang="en">
      <body className="min-h-screen">
        <div className="flex min-h-screen">
          <Nav />
          <main className="flex-1 min-w-0">{children}</main>
        </div>
      </body>
    </html>
  );

  // Only mount ClerkProvider when configured — keeps the app (and `next build`)
  // working on the dev-stub auth with no Clerk env.
  return process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? <ClerkProvider>{shell}</ClerkProvider> : shell;
}
