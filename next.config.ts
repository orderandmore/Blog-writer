import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // "standalone" was for the Docker target. Vercel doesn't need it; remove
  // to keep build output Vercel-default.
  serverExternalPackages: ["sharp", "pg"],
  images: {
    // Allow <Image> usage from her WP-uploaded media and Vercel Blob.
    remotePatterns: [
      { protocol: "https", hostname: "orderandmore.com" },
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
    ],
  },
};

export default nextConfig;
