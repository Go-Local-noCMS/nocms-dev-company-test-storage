import type { Metadata } from "next";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import "./globals.css";

export const metadata: Metadata = {
  title: "test storage",
  description: "Built with NoCMS",
};
// Inspector script is gated server-side by env (set only by the editor when
// spawning preview dev servers). The script self-no-ops without ?nocms-edit=1.
const editorOrigin = process.env.NEXT_PUBLIC_APP_ORIGIN;


export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Unbounded:wght@400;500;600;700&family=Figtree:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
        {editorOrigin && (
          <script async src={`${editorOrigin}/nocms-inspector.js`} />
        )}
      </head>
      <body className="font-body antialiased text-text bg-background">
        <Navbar />
        <main id="main-content">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
