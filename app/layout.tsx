import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { brand } from "@/lib/config";
import { Footer } from "@/components/Footer";

const description = `Vote head to head for the best local spots in Charlotte. Presented by ${brand.presentedBy}.`;

export const metadata: Metadata = {
  metadataBase: new URL(brand.siteUrl),
  icons: { icon: "/logo.png", apple: "/logo.png" },
  title: {
    default: `${brand.name}: the Charlotte bracket`,
    template: `%s | ${brand.name}`,
  },
  description,
  openGraph: {
    title: `${brand.name}: the Charlotte bracket`,
    description,
    siteName: brand.name,
    type: "website",
  },
  twitter: {
    card: "summary",
    title: `${brand.name}: the Charlotte bracket`,
    description,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f7f2ea",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-3 focus:text-black"
        >
          Skip to content
        </a>
        <div className="flex min-h-dvh flex-col">
          <header className="border-b-2 border-line bg-ink/90">
            <div className="mx-auto flex min-h-14 w-full max-w-5xl items-center px-4">
              <Link
                href="/"
                className="display flex min-h-12 items-center gap-2 text-2xl text-chalk"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo.png" alt={brand.name} width={44} height={40} className="h-10 w-auto" />
              </Link>
            </div>
          </header>
          <main id="main" className="flex-1">
            {children}
          </main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
