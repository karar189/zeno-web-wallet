import { MotionRoot } from "@/components/motion/motion-root";
import type { Metadata } from "next";
import { Geist_Mono, Inter, Outfit } from "next/font/google";
import "./globals.css";
import "./instrument.css";
import "./app-desk.css";
import "./app-v2.css";

const landingSans = Outfit({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-landing-sans",
});

const appSans = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-app",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Zeno Wallet",
  description:
    "A Zcash wallet for deliberate payments. Send shielded ZEC, understand route privacy, and share account visibility on your terms.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${appSans.variable} ${landingSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <MotionRoot>{children}</MotionRoot>
      </body>
    </html>
  );
}
