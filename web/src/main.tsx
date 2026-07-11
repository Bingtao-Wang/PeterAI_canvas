import React from "react";
import { createRoot } from "react-dom/client";
import "antd/dist/reset.css";
import "streamdown/styles.css";
import "./styles/globals.css";
import { bootstrapPeterSession } from "@/peter/session";
import { PeterBootstrapError } from "@/peter/bootstrap-error";

document.body.style.fontFamily = '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif';

const root = createRoot(document.getElementById("root")!);

void bootstrapPeterSession()
    .then(async () => {
        const [{ RouterProvider }, { AppProviders }, { router }] = await Promise.all([
            import("react-router-dom"),
            import("@/components/layout/app-providers"),
            import("@/router"),
        ]);
        root.render(
            <React.StrictMode>
                <AppProviders>
                    <RouterProvider router={router} />
                </AppProviders>
            </React.StrictMode>,
        );
    })
    .catch((error: unknown) => {
        root.render(<PeterBootstrapError message={error instanceof Error ? error.message : "PeterAI 画布初始化失败"} />);
    });
