import type { Metadata } from "next";
import { Geist, Geist_Mono, Space_Grotesk } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import Providers from "./providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: {
    default: "Velora — Your Financial Clarity",
    template: "%s · Velora",
  },
  description: "Track spending, set budgets, and see where every rupee goes.",
};

// The production Clerk instance lives on a Vercel subdomain we can't add DNS
// records to, so the browser reaches Clerk through our own /__clerk proxy
// (see proxy.ts). The dev instance (pk_test_) talks to Clerk directly.
const clerkProxyUrl = (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '').startsWith('pk_live_')
  ? '/__clerk'
  : undefined;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider proxyUrl={clerkProxyUrl}>
      <html
        lang="en"
        className={`${geistSans.variable} ${geistMono.variable} ${spaceGrotesk.variable} h-full antialiased`}
      >
        <body className="min-h-full flex flex-col">
          <Providers>{children}</Providers>
        </body>
      </html>
    </ClerkProvider>
  );
}
