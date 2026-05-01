import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable standalone output for Docker production builds
  output: 'standalone',

  // Fix hot reload in Docker on Windows - webpack polling with proper configuration
  webpack: (config) => {
    config.watchOptions = {
      poll: 500, // Check for changes every 500ms
      aggregateTimeout: 300, // Delay before rebuilding
      ignored: /node_modules/,
    };
    return config;
  },

  // Disable turbopack to use webpack with polling (turbopack doesn't support polling yet)
  turbopack: {},

  // Environment variables validation
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  },
};

export default nextConfig;
