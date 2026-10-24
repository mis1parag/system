import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Parag Unify Crafts Panel",
    short_name: "Parag Unify",
    description: "Parag Unify Crafts management panel",
    start_url: "/flows",
    display: "standalone",
    background_color: "#f5f5f5",
    theme_color: "#2459c7",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
