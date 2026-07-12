import { useEffect } from "react";
import {
  SignedIn,
  SignedOut,
  SignIn,
  CreateOrganization,
  OrganizationSwitcher,
  useAuth,
  useUser,
  useClerk,
} from "@clerk/clerk-react";
import { Dashboard } from "./views/Dashboard.tsx";

export const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
export const clerkEnabled = Boolean(CLERK_PUBLISHABLE_KEY);

/** Real Clerk flow (renders only when a publishable key is configured). */
export function ClerkApp() {
  return (
    <>
      <SignedOut>
        <div className="center">
          <SignIn routing="virtual" />
        </div>
      </SignedOut>
      <SignedIn>
        <ClerkGate />
      </SignedIn>
    </>
  );
}

function ClerkGate() {
  const { orgId, isSignedIn } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();

  // When Clerk signs out, tell main to drop its client too.
  useEffect(() => {
    if (!isSignedIn) void window.leadEngine.auth.signOut();
  }, [isSignedIn]);

  if (!orgId) {
    return (
      <div className="center">
        <div className="card auth-card">
          <h1 className="brand">Choose an organization</h1>
          <p className="muted">Leads are scoped to your agency — pick or create one to continue.</p>
          <OrganizationSwitcher hidePersonal afterCreateOrganizationUrl="/" afterSelectOrganizationUrl="/" />
          <CreateOrganization afterCreateOrganizationUrl="/" />
        </div>
      </div>
    );
  }

  return (
    <>
      <ClerkTokenBridge />
      <Dashboard email={user?.primaryEmailAddress?.emailAddress ?? ""} onSignOut={() => void signOut()} />
    </>
  );
}

/**
 * Pushes the current Clerk session token (+ org/email) to the main process, and
 * re-pushes a fresh one before the ~60s expiry so sync/registration keep a valid
 * token. This is how the renderer's Clerk session reaches main.
 */
function ClerkTokenBridge() {
  const { getToken, orgId, isSignedIn } = useAuth();
  const { user } = useUser();

  useEffect(() => {
    if (!isSignedIn || !orgId) return;
    let stopped = false;

    const push = async () => {
      try {
        const token = await getToken();
        if (!token || stopped) return;
        await window.leadEngine.auth.setSession({
          email: user?.primaryEmailAddress?.emailAddress ?? "",
          orgId,
          token,
          expiresAt: Date.now() + 55_000,
        });
      } catch {
        /* transient — the next tick retries */
      }
    };

    void push();
    const id = setInterval(() => void push(), 45_000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [isSignedIn, orgId, getToken, user]);

  return null;
}
