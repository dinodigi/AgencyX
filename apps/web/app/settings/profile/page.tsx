import { withClient, isConfigured } from "@/lib/agentx.ts";
import { getAuthStatus } from "@/lib/auth.ts";
import { PageHeader, NotConfigured, EmptyState } from "@/components/ui.tsx";
import { AuthGate } from "@/components/AuthGate.tsx";
import { ProfileForm } from "@/components/ProfileForm.tsx";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  if (!isConfigured()) return <NotConfigured />;
  const status = await getAuthStatus();
  if (status !== "ready") return <AuthGate status={status} />;
  const ctx = await withClient();
  if (!ctx) return <AuthGate status="signed-out" />;

  let initial: Record<string, string | undefined> | null = null;
  let error: string | null = null;
  try {
    const rows = await ctx.ax.agencies.list({ limit: 1 });
    const a = rows[0];
    if (a) {
      initial = {
        name: a.name,
        logo_url: a.logo_url,
        tagline: a.tagline,
        website: a.website,
        phone: a.phone,
        email: a.email,
        address: a.address,
        brand_color: a.brand_color,
        accent_color: a.accent_color,
        proposal_footer: a.proposal_footer,
      };
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div>
      <PageHeader title="Agency profile" subtitle="Your company identity — brands every proposal you send." />
      <div className="p-8">
        {error ? <EmptyState title="Couldn't load profile" hint={error} /> : <ProfileForm initial={initial} />}
      </div>
    </div>
  );
}
