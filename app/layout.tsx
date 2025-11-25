import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Stankevicius.com AI Market Insights",
  description:
    "AI generated trade insights for tri-arbitrage and leverage positions.",
  keywords: [
    "crypto trading",
    "stankevicius",
    "ai crypto trading",
    "ai tri-arbitrage",
    "ai leverage trading",
    "ai trading recommendations",
  ],
  icons: {
    icon: "logo.jpg",
  },
  openGraph: {
    title: "Stankevicius.com AI Market Insights",
    description:
      "AI generated trade insights for tri-arbitrage and leverage positions.",
    url: "https://stankevicius.com",
    siteName: "Stankevicius.com",
    images: [
      {
        url: "https://corporate.stankeviciusgroup.com/assets/thumbss.png",
        width: 1200,
        height: 630,
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stankevicius.com AI Market Insights",
    description:
      "AI generated trade insights for tri-arbitrage and leverage positions.",
    images: ["https://corporate.stankeviciusgroup.com/assets/thumbss.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
