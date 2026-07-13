/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages ship TS source (with .ts-extension imports) — Next
  // transpiles them rather than expecting pre-built JS.
  transpilePackages: ["@dinosales/agentx-client", "@dinosales/types", "@dinosales/ui"],
  eslint: { ignoreDuringBuilds: true },
  // Logo upload goes through the uploadLogo server action; Next caps server-action
  // request bodies at 1 MB by default, which 500s on real logos. AgentX accepts up
  // to 10 MB, so allow headroom for that plus multipart overhead.
  experimental: {
    serverActions: {
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
