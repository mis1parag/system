import type { MetadataRoute } from "next";
import { BRAND, BRAND_SHORT } from "@/lib/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${BRAND} Panel`,
    short_name: BRAND_SHORT,
    description: `${BRAND} management panel`,
    start_url: "/flows",
    display: "standalone",
    background_color: "#f5f5f5",
    theme_color: "#2459c7",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
