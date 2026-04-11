import type { Metadata } from "next";
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
      <body className="h-full overflow-hidden">{children}</body>
    </html>
  );
}
