"use client";

import { ClerkLoading, ClerkLoaded, SignIn, CreateOrganization, OrganizationSwitcher } from "@clerk/nextjs";
import type { AuthStatus } from "@/lib/auth.ts";

const clerkOn = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

/**
 * Full-page auth gate. Distinguishes signed-out (show sign-in) from no-org
 * (show org picker/create) so an authenticated user is never told "not signed
 * in". ClerkLoading keeps a visible state while Clerk's client initializes —
 * so the login area never silently blanks.
 */
export function AuthGate({ status }: { status: AuthStatus }) {
  // Dev-stub mode (no Clerk on the client): explain how to sign in.
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
          <SignIn routing="hash" />
        )}
      </ClerkLoaded>
    </div>
  );
}
