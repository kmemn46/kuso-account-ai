import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ConfigureAmplify } from "@/lib/amplifyConfig";
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
  title: "Kuso App",
  description: "Auth with Cognito & Amplify",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* アプリの最初にAmplifyの設定を呼び出す */}
        <ConfigureAmplify />
        {children}
      </body>
    </html>
  );
}
