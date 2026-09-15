import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VoltApp — Gestion Électricien",
  description: "Devis, clients, catalogue et CRM pour électricien indépendant",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "VoltApp",
  },
  icons: {
    icon: "/favicon.ico",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#1a1a2e",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head>
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body className="bg-ink-50 text-ink-900 antialiased">
        {children}
      </body>
    </html>
  );
}
