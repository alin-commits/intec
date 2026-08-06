import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Intec Commercial Hub",
  description: "Panel interno de consultas, leads y campañas de Suministros Intec.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es">
      <body>
        {children}
        <SpeedInsights />
      </body>
    </html>
  );
}
