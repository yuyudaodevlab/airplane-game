import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_ACTIONS === "true";
const repositoryBasePath = "/airplane-game";

const nextConfig: NextConfig = {
  output: isGitHubPages ? "export" : undefined,
  basePath: isGitHubPages ? repositoryBasePath : undefined,
  assetPrefix: isGitHubPages ? repositoryBasePath : undefined,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
