import type { Metadata } from "next";
import { Hammersmith_One, Roboto } from "next/font/google";
import "./globals.css";

const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin"],
  weight: ["100", "300", "400", "500"],
});

const hammersmithOne = Hammersmith_One({
  variable: "--font-hammersmith-one",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "Whiteboard Mod — Simple Online Whiteboard",
  description:
    "Whiteboard Mod: pizarrón online simple y colaborativo, sin cuentas ni inicio de sesión.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${roboto.variable} ${hammersmithOne.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
