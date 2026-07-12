/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages ship TS source (with .ts-extension imports) — Next
  // transpiles them rather than expecting pre-built JS.
  transpilePackages: ["@dinosales/agentx-client", "@dinosales/types", "@dinosales/ui"],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
