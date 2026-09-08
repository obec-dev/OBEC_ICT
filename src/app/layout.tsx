import type { Metadata } from "next";
import { Prompt } from "next/font/google";
import "./globals.css";
import { Nav } from "./components/Nav";
import { IctStoreProvider } from "@/contexts/IctStore";

const prompt = Prompt({
  subsets: ["thai", "latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
  variable: "--font-prompt",
});

export const metadata: Metadata = {
  title: "ตัวแทน ICT Talent ประจำโรงเรียน",
  description: "แพลตฟอร์มลงทะเบียนและสอบคัดเลือกตัวแทน ICT ประจำโรงเรียน",
  icons: {
    icon: `data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🏫</text></svg>`,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th" className={prompt.variable}>
      <head>
        <link
          rel="stylesheet"
          href="https://cdn-uicons.flaticon.com/2.1.0/uicons-solid-rounded/css/uicons-solid-rounded.css"
        />
      </head>
      <body className={`${prompt.className} antialiased`}>
        <IctStoreProvider>
          <div className="fixed inset-0 z-[-1] pointer-events-none overflow-hidden bg-[var(--background)]">
            <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] rounded-full bg-[var(--primary-blue)] opacity-5 blur-3xl animate-float"></div>
            <div className="absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] rounded-full bg-[var(--secondary-blue)] opacity-5 blur-3xl animate-float" style={{ animationDelay: "1.5s" }}></div>
          </div>
          <Nav />
          <main className="min-h-[calc(100vh-56px)]">{children}</main>
        </IctStoreProvider>
      </body>
    </html>
  );
}
