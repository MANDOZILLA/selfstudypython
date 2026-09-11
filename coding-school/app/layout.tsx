import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Workbench School", description: "Practical coding evidence, not completion theater." };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en"><body>{children}</body></html>
  );
}
