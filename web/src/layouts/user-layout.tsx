import type { ReactNode } from "react";

import { AgentPanel } from "@/components/agent/agent-panel";
import { AppConfigModal } from "@/components/layout/app-config-modal";
import { AppTopNav } from "@/components/layout/app-top-nav";
import { getPeterSession } from "@/peter/session";

export default function UserLayout({ children }: { children: ReactNode }) {
    const embedded = Boolean(getPeterSession()?.embedded);
    return (
        <div className="flex h-dvh overflow-hidden bg-background text-foreground">
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                {!embedded ? <AppTopNav /> : null}
                <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
            </div>
            <AgentPanel />
            <AppConfigModal />
        </div>
    );
}
