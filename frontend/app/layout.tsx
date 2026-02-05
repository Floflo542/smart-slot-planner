import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Smart Slot Planner",
  description: "Planification intelligente et ajout automatique dans Outlook.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
