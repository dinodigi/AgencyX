/**
 * Where the desktop client comes from. One definition, used by every download
 * affordance (sidebar, Devices page) so a rename can't leave a dead link behind.
 *
 * The URL is permanent: electron-builder publishes the installer under a fixed,
 * version-less name (apps/desktop/electron-builder.yml → win.artifactName), and
 * GitHub resolves /releases/latest to the newest PUBLISHED release. Note the
 * emphasis — /latest skips drafts, and electron-builder drafts releases by
 * default, so a green build alone does NOT make this link resolve. The release
 * has to be published (see pm/BACKLOG.md AX-024).
 */
export const DESKTOP_DOWNLOAD_URL =
  "https://github.com/dinodigi/AgencyX/releases/latest/download/AgencyX-Setup.exe";

/**
 * Shown wherever we offer the download. The installer is not yet Authenticode
 * signed, so a fresh machine gets a SmartScreen warning — saying so up front is
 * what stops it reading as malware (cert tracked as pm/BACKLOG.md AX-004).
 */
export const DESKTOP_DOWNLOAD_HINT =
  "Windows installer — unsigned for now, so SmartScreen may warn: More info → Run anyway. Updates itself after install.";
