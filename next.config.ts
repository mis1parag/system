import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: { root: path.resolve(__dirname) },
  // lets the dev server also be opened as http://127.0.0.1:3000 (a second browser identity for testing); has no effect in production
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
