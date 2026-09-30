import type { Metadata } from "next";
import { Prompt } from "next/font/google";
import "./globals.css";
import { Nav } from "./components/Nav";
import { PassCelebrationModal } from "./components/PassCelebrationModal";
import { SessionLifecycleGuard } from "./components/SessionLifecycleGuard";
import { SessionTimeoutGuard } from "./components/SessionTimeoutGuard";
import { ThemeProvider } from "./components/ThemeProvider";
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
    icon: [{ url: "/OBEC_ICT_Favcon.jpeg", type: "image/jpeg" }],
    apple: [{ url: "/OBEC_ICT_Favcon.jpeg", type: "image/jpeg" }],
    shortcut: "/OBEC_ICT_Favcon.jpeg",
  },
};

const themeBootScript = `
(function(){
  try {
    var t = localStorage.getItem('ict_theme');
    if (t === 'dark') {
      document.documentElement.classList.add('dark');
    }
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th" className={prompt.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        <link
          rel="stylesheet"
          href="https://cdn-uicons.flaticon.com/2.1.0/uicons-solid-rounded/css/uicons-solid-rounded.css"
        />
      </head>
      <body className={`${prompt.className} antialiased bg-[var(--background)] text-[var(--foreground)]`}>
        <ThemeProvider>
          <IctStoreProvider>
            <SessionLifecycleGuard />
            <SessionTimeoutGuard />
      <div className="fixed inset-0 z-[-1] pointer-events-none overflow-hidden bg-[var(--background)]">
              <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] rounded-full bg-[var(--primary-solid)] opacity-[0.04] dark:opacity-[0.08] blur-3xl"></div>
              <div
                className="absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] rounded-full bg-[var(--secondary-blue)] opacity-[0.04] dark:opacity-[0.06] blur-3xl"
              ></div>
            </div>
            <Nav />
            <PassCelebrationModal />
            <main className="min-h-[calc(100vh-56px)]">{children}</main>
          </IctStoreProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
