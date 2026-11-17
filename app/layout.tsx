import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { brand } from "@/lib/config";
import { Footer } from "@/components/Footer";

const description = `Vote head to head for the best local spots in Charlotte. Presented by ${brand.presentedBy}.`;

export const metadata: Metadata = {
  metadataBase: new URL(brand.siteUrl),
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
  themeColor: "#0a0a0c",
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
                <span aria-hidden="true" className="inline-block h-5 w-5 -skew-x-12 bg-accent" />
                {brand.name}
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
