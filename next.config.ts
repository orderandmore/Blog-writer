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
  // Defense-in-depth headers. The portal is already password-gated and HTTPS
  // (HSTS comes from Vercel), so these are belt-and-suspenders, but cheap.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Block the portal from being framed (clickjacking).
          { key: "X-Frame-Options", value: "DENY" },
          // Don't let browsers MIME-sniff responses.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Don't leak full URLs (which can carry draft IDs) to other origins.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Turn off device APIs the portal never uses.
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
