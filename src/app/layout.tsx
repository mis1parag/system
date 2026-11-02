import type { Metadata, Viewport } from "next";
import { BRAND } from "@/lib/brand";
import { Geist_Mono, Inter } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const bodyFont = Inter({ variable: "--font-body", subsets: ["latin"], display: "swap" });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: `${BRAND} Panel`,
  description: `${BRAND} — one panel for tasks, checklists, attendance and salary slips`,
  applicationName: `${BRAND} Panel`,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#635bff",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${bodyFont.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-background">
        {children}
        <Toaster position="top-center" theme="light" richColors />
      </body>
    </html>
  );
}
