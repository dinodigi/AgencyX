"use client";

import {
  ClerkLoading,
  ClerkLoaded,
  SignedIn,
  SignedOut,
  SignIn,
  SignOutButton,
  CreateOrganization,
  OrganizationSwitcher,
} from "@clerk/nextjs";
import type { AuthStatus } from "@/lib/auth.ts";

const clerkOn = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

/**
 * Full-page auth gate. Distinguishes signed-out (show sign-in) from no-org (show
 * org picker/create) so an authenticated user is never told "not signed in".
 * ClerkLoading keeps a visible state while Clerk's client initializes.
 *
 * Split-brain guard: if the client is signed in but the SERVER routed us to the
 * gate (it couldn't validate the session — almost always a missing
 * CLERK_SECRET_KEY), show that explicitly instead of a blank sign-in that loops.
 */
export function AuthGate({ status }: { status: AuthStatus }) {
  if (!clerkOn) {
    return (
      <div className="p-8">
        <div className="mx-auto max-w-md rounded-xl border border-dashed border-[var(--color-border)] p-10 text-center">
          <p className="text-sm">Not signed in</p>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            Set the Clerk keys in <code>apps/web/.env.local</code> and restart, or use the dev-auth env vars.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-[70vh] place-items-center p-8">
      <ClerkLoading>
        <p className="text-sm text-[var(--color-muted)]">Loading sign-in…</p>
      </ClerkLoading>
      <ClerkLoaded>
        {status === "no-org" ? (
          <div className="flex flex-col items-center gap-4">
            <p className="text-sm text-[var(--color-muted)]">Select or create an organization to continue.</p>
            <OrganizationSwitcher hidePersonal afterCreateOrganizationUrl="/leads" afterSelectOrganizationUrl="/leads" />
            <CreateOrganization afterCreateOrganizationUrl="/leads" />
          </div>
        ) : (
          <>
            <SignedOut>
              <SignIn routing="hash" />
            </SignedOut>
            <SignedIn>
              <div className="mx-auto max-w-md rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center">
                <p className="text-sm font-medium">Signed in — but the server didn't recognize your session.</p>
                <p className="mt-2 text-sm text-[var(--color-muted)]">
                  This dev server is missing <code>CLERK_SECRET_KEY</code>. Add it to <code>apps/web/.env.local</code> and
                  restart, then reload.
                </p>
                <div className="mt-4">
                  <SignOutButton>
                    <button className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-ink)]">
                      Sign out
                    </button>
                  </SignOutButton>
                </div>
              </div>
            </SignedIn>
          </>
        )}
      </ClerkLoaded>
    </div>
  );
}
