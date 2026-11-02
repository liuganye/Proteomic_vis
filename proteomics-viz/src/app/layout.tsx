import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Proteomics Viz — FragPipe-style analyst",
  description: "QC and downstream proteomics visualization over FragPipe MaxLFQ outputs",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className="antialiased">{children}</body></html>;
}
