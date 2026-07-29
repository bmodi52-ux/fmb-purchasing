import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Server Actions cap request bodies at 1MB by default, and receipts are
    // uploaded through one. A PDF forwarded from email sits well under that
    // (the ones tested were 73KB and 160KB), but a photo taken on a phone is
    // routinely 2-5MB — so the cap threw a server error the moment anyone
    // photographed a receipt instead of forwarding one.
    //
    // Not raised further because the host imposes its own request body limit
    // that this cannot exceed, and the limit also covers multipart boundary
    // and header overhead on top of the file itself. The client downscales
    // images before sending (lib/image-resize.ts) so real uploads land far
    // below this rather than relying on the ceiling.
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
