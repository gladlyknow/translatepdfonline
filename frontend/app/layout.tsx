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
  title: "在线 PDF 翻译 | Online PDF Translation",
  description: "中英西互译的在线 PDF 翻译服务",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh" suppressHydrationWarning>
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
