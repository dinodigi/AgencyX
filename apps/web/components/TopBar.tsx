"use client";

import {
  ClerkLoading,
  ClerkLoaded,
  SignedIn,
  SignedOut,
  SignInButton,
  UserButton,
  OrganizationSwitcher,
} from "@clerk/nextjs";
import { ThemeToggle } from "@/components/ThemeToggle.tsx";

// Clerk components require ClerkProvider (mounted only when configured), so the
// auth UI is gated on the same public key the provider is.
const clerkOn = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

/** Slim account bar above every page: theme switch + org switcher + account,
 *  right-aligned. PageHeader sticks directly beneath it (top-12). */
export function TopBar() {
  return (
    <header className="sticky top-0 z-40 flex h-12 items-center justify-end gap-3 border-b border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-bg)_82%,transparent)] px-4 backdrop-blur-md">
      <ThemeToggle />
      {clerkOn ? (
        <>
          <ClerkLoading>
            <span className="text-xs text-[var(--color-muted)]">Loading…</span>
          </ClerkLoading>
          <ClerkLoaded>
            <SignedIn>
              <OrganizationSwitcher hidePersonal />
              <UserButton />
            </SignedIn>
            <SignedOut>
              <SignInButton mode="modal">
                <button className="btn-primary px-3 py-1.5 text-sm">Sign in</button>
              </SignInButton>
            </SignedOut>
          </ClerkLoaded>
        </>
      ) : (
        <span className="text-xs text-[var(--color-muted)]">Internal · tenant #1 · Clerk off</span>
      )}
    </header>
  );
}
