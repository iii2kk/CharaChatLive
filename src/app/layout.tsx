import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "CharaChatLive - MMD Viewer",
  description: "MMD model and motion viewer built with Next.js and Three.js",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full">
      <body className="h-full overflow-hidden">
        {/* Live2D Cubism Core runtime. Loaded as a plain script (not bundled)
            to comply with the Live2D Proprietary Software License which prohibits
            modification/concatenation of the distributed min.js. */}
        <Script
          src="/live2dcubismcore.min.js"
          strategy="beforeInteractive"
        />
        {children}
      </body>
    </html>
  );
}
