import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { connection } from "next/server";
import { Toaster } from "sonner";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Quotation Panel", template: "%s · Quotation Panel" },
  description: "Inventory and quotation management for pipe fittings.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#1a37c9",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Every page is rendered per request so it receives the CSP nonce set in proxy.ts.
  await connection();

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <body className="min-h-full">
        {children}
        <Toaster position="top-right" richColors closeButton toastOptions={{ duration: 3500 }} />
      </body>
    </html>
  );
}
