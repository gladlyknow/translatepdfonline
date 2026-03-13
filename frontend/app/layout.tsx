import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthProvider } from "@/components/AuthProvider";
import { FingerprintPreloader } from "@/components/FingerprintPreloader";
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
  title: "Online PDF Translation",
  description: "Translate PDF documents online between English, Chinese and Spanish. Fast and free.",
  applicationName: "Online PDF Translation",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased flex flex-col h-screen overflow-hidden`}
      >
        <AuthProvider>
          <FingerprintPreloader />
          <div className="flex min-h-0 flex-1 flex-col overflow-auto">
            {children}
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
