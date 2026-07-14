import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import { Nav } from "@/components/Nav.tsx";
import { TopBar } from "@/components/TopBar.tsx";

/** Apply the persisted theme before first paint (no flash). Dark = default. */
const THEME_SCRIPT = `try{if(localStorage.getItem("ax-theme")==="light")document.documentElement.dataset.theme="light"}catch(e){}`;

export const metadata: Metadata = {
  title: "AgencyX",
  description: "Agency lead engine — scrape, qualify, build, propose, sell.",
};

// The app is inherently per-request (org-scoped auth) — nothing to prerender.
// This also keeps ClerkProvider out of static generation of /_not-found.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: ReactNode }) {
  const shell = (
    // suppressHydrationWarning: the theme script sets data-theme pre-hydration.
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen">
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <div className="flex min-h-screen">
          <Nav />
          <main className="min-w-0 flex-1">
            <TopBar />
            {children}
          </main>
        </div>
      </body>
    </html>
  );

  // Only mount ClerkProvider when configured — keeps the app (and `next build`)
  // working on the dev-stub auth with no Clerk env.
  return process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? <ClerkProvider>{shell}</ClerkProvider> : shell;
}
