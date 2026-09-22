import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Outfit, Tajawal } from "next/font/google";
import "./globals.css";
import "@glideapps/glide-data-grid/dist/index.css";

export const metadata: Metadata = {
  title: "Infinity Studio",
  description: "The Infinity Scale database studio.",
};

import { ThemeProvider } from "@/components/providers/theme-provider";
import { IconThemeProvider } from "@/components/providers/icon-theme-provider";
import { ZoomWrapper } from "@/components/zoom-wrapper";
import { Toaster } from "sonner";
import { ConfirmProvider } from "@/hooks/use-confirm";
import { UpdateNotificationProvider } from "@/components/providers/update-notification-provider";
import { AppUpdateProvider } from "@/components/providers/app-update-context";
import { ClientShim } from "@/components/client-shim";
import { SettingsMigrationGate } from "@/components/gates/settings-migration-gate";
import { SidecarGate } from "@/components/gates/sidecar-gate";
import { ApiKeyGate } from "@/components/gates/api-key-gate";
import { ExtensionProvider } from "@/lib/extensions/react";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
});

const tajawalArabic = Tajawal({
  subsets: ["arabic"],
  variable: "--font-arabic",
  weight: ["200", "300", "400", "500", "700", "800", "900"],
});

// The self-hosted families a preset may name (lib/studio/themes/theme-fonts.ts): on <html> so root variables resolve them, fetched only once used.
const interSelf = Inter({
  subsets: ["latin"],
  variable: "--font-inter-self",
  preload: false,
});

const jetbrainsMonoSelf = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono-self",
  preload: false,
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${interSelf.variable} ${jetbrainsMonoSelf.variable}`} suppressHydrationWarning>
      <head>
        {/* Apply stored light/dark + custom app theme colors before paint, to
            avoid a splash/flash of the default theme. The theme vars cache is
            kept warm by hooks/use-global-app-theme.ts; on /embed a host theme
            cached per tab by lib/embed/host-theme.ts comes first. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var el=document.documentElement;var p=location.pathname;var emb=p==="/embed"||p.indexOf("/embed/")===0;var t=localStorage.getItem("theme");var d=window.matchMedia("(prefers-color-scheme: dark)").matches;var r=t==="light"||t==="dark"?t:(d?"dark":"light");var av=null;try{var raw=emb?sessionStorage.getItem("infinity-studio:embed-theme-vars"):null;if(!raw)raw=localStorage.getItem("infinity-studio-app-theme-vars");if(raw)av=JSON.parse(raw);}catch(e2){av=null;}if(av&&av.colors&&(av.base==="light"||av.base==="dark")){r=av.base;}el.classList.remove("light","dark");el.classList.add(r);el.style.colorScheme=r;if(av&&av.colors){for(var k in av.colors){if(Object.prototype.hasOwnProperty.call(av.colors,k)){el.style.setProperty(k,av.colors[k]);}}if(av.id)el.dataset.appTheme=av.id;}}catch(e){}})();`,
          }}
        />
      </head>
      <body className={`${outfit.variable} ${tajawalArabic.variable} antialiased`}>
        <IconThemeProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <ClientShim />
            <SettingsMigrationGate />
            <ZoomWrapper>
              <SidecarGate>
                <ApiKeyGate>
                <ConfirmProvider>
                  <AppUpdateProvider>
                    <UpdateNotificationProvider>
                      <ExtensionProvider>
                      {children}
                      </ExtensionProvider>
                      <Toaster
                        position="bottom-right"
                        theme="system"
                        toastOptions={{
                          unstyled: false,
                          classNames: {
                            toast: "infinity-toast",
                            success: "infinity-toast-success",
                            error: "infinity-toast-error",
                            warning: "infinity-toast-warning",
                            info: "infinity-toast-info",
                          },
                        }}
                      />
                  </UpdateNotificationProvider>
                  </AppUpdateProvider>
                </ConfirmProvider>
                </ApiKeyGate>
              </SidecarGate>
            </ZoomWrapper>
          </ThemeProvider>
        </IconThemeProvider>
        {/* Mount point for Glide Data Grid's overlay cell editors — must be
            the last child of <body>, see @glideapps/glide-data-grid docs. */}
        <div id="portal" />
      </body>
    </html>
  );
}
