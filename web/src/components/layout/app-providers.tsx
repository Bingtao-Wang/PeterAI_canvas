import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { ProConfigProvider } from "@ant-design/pro-components";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";

import { ClientRootInit } from "@/components/layout/client-root-init";
import { getAntThemeConfig } from "@/lib/app-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { getPeterSession } from "@/peter/session";
import { PeterBootstrapError } from "@/peter/bootstrap-error";

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30_000,
            retry: false,
            refetchOnWindowFocus: false,
        },
    },
});

export function AppProviders({ children }: { children: ReactNode }) {
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const dark = theme === "dark";
    const [sessionInvalid, setSessionInvalid] = useState(false);

    useEffect(() => {
        const invalidate = () => setSessionInvalid(true);
        window.addEventListener("peterai:session-invalid", invalidate);
        return () => window.removeEventListener("peterai:session-invalid", invalidate);
    }, []);

    useEffect(() => {
        const embeddedTheme = getPeterSession()?.theme;
        if (embeddedTheme && embeddedTheme !== theme) setTheme(embeddedTheme);
    }, [setTheme, theme]);

    useEffect(() => {
        document.documentElement.classList.toggle("dark", dark);
        document.documentElement.style.colorScheme = theme;
    }, [dark, theme]);

    if (sessionInvalid) return <PeterBootstrapError message="PeterAI 登录已失效，请重新登录后进入画布" />;

    return (
        <ConfigProvider locale={zhCN} theme={getAntThemeConfig(dark)}>
            <ProConfigProvider dark={dark}>
                <App>
                    <QueryClientProvider client={queryClient}>
                        <ClientRootInit>{children}</ClientRootInit>
                    </QueryClientProvider>
                </App>
            </ProConfigProvider>
        </ConfigProvider>
    );
}
