import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "./e2e",
    fullyParallel: false,
    retries: process.env.CI ? 1 : 0,
    reporter: "line",
    use: {
        baseURL: "http://127.0.0.1:4173",
        launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
        trace: "retain-on-failure",
    },
    webServer: {
        command: "npm run start -- --host 127.0.0.1 --port 4173",
        url: "http://127.0.0.1:4173",
        reuseExistingServer: !process.env.CI,
    },
});
