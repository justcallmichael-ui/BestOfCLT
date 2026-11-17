import type { Metadata } from "next";
import type { ReactNode } from "react";
import { brand } from "@/lib/config";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
  manifest: "/admin/manifest.webmanifest",
  icons: { apple: "/api/og/admin-icon?size=180" },
  appleWebApp: { capable: true, title: `${brand.name} Admin` },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-neutral-50 text-neutral-900">{children}</div>;
}
