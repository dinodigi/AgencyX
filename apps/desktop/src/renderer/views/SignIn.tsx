import { useState } from "react";

/**
 * Sign-in shell. The real flow embeds Clerk's sign-in (W1) and hands the minted
 * session JWT + org claim to the main process. Until Clerk is wired, this dev
 * form accepts a pasted token so the rest of the app can be exercised end-to-end
 * against a real org. It never stores anything itself — main owns the keychain.
 */
export function SignIn() {
  const [email, setEmail] = useState("");
  const [orgId, setOrgId] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await window.leadEngine.auth.setSession({
        email,
        orgId,
        token: token.trim(),
        // Dev default: 55 minutes. The real Clerk flow pushes actual expiries.
        expiresAt: Date.now() + 55 * 60 * 1000,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <div className="card auth-card">
        <div className="brand-row">
          <span className="brand-mark">AX</span>
          <h1 className="brand">
            Agency<span className="x">X</span>
          </h1>
        </div>
        <p className="muted">Sign in to run the scraper</p>

        <label>Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@agency.com" />

        <label>Org ID (Clerk org_id claim)</label>
        <input value={orgId} onChange={(e) => setOrgId(e.target.value)} placeholder="org_..." />

        <label>Session JWT (dev — paste until Clerk UI is wired)</label>
        <textarea value={token} onChange={(e) => setToken(e.target.value)} rows={3} placeholder="eyJ..." />

        {error && <p className="error">{error}</p>}

        <button className="primary" disabled={busy || !email || !orgId || !token} onClick={submit}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </div>
    </div>
  );
}
