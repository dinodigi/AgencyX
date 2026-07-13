import { SettingsTabs } from "@/components/SettingsTabs.tsx";

export const dynamic = "force-dynamic";

/** Agency settings area — shared tab bar across Profile and Packages. */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <SettingsTabs />
      {children}
    </div>
  );
}
