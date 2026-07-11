import { expect, test } from "@playwright/test";

const canvasPath = "/canvas?mode=recent&token=e2e-jwt&src_host=https%3A%2F%2Fapi.peterai.cc.cd&ui_mode=embedded&user_id=999";

test.beforeEach(async ({ page }) => {
    await page.route("**/peter-api/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith("/auth/me")) return route.fulfill({ json: { code: 0, data: { id: 42, username: "e2e" } } });
        if (path.endsWith("/keys")) return route.fulfill({ json: { code: 0, data: { items: [] } } });
        if (path.endsWith("/image-generation/options")) return route.fulfill({ json: { code: 0, data: { keys: [] } } });
        if (path.endsWith("/channels/available")) return route.fulfill({ json: { code: 0, data: [] } });
        return route.fulfill({ status: 404, json: { error: { message: "not found" } } });
    });
});

test("cleans credentials, isolates storage, and only hides navigation inside an iframe", async ({ page }) => {
    await page.goto(canvasPath);
    await expect(page.getByRole("button", { name: "打开画布菜单" })).toBeVisible();
    expect(page.url()).not.toContain("token=");
    expect(page.url()).not.toContain("user_id=");
    const topLevelStorage = await page.evaluate(() => ({
        local: JSON.stringify(localStorage),
        session: JSON.stringify(sessionStorage),
        verifiedUserId: JSON.parse(sessionStorage.getItem("peterai-canvas:peter-session:v1") || "null")?.userId,
    }));
    expect(topLevelStorage.local).not.toContain("e2e-jwt");
    expect(topLevelStorage.session).toContain("e2e-jwt");
    expect(topLevelStorage.verifiedUserId).toBe(42);

    await page.goto("/");
    await page.setContent(`<iframe style="width:1200px;height:800px" src="http://127.0.0.1:4173${canvasPath}"></iframe>`);
    await page.locator("iframe").waitFor();
    const frame = await (await page.locator("iframe").elementHandle())!.contentFrame();
    expect(frame).toBeTruthy();
    await expect(frame!.getByRole("button", { name: "打开画布菜单" })).toBeVisible();
    expect(frame!.url()).not.toContain("token=");

    const imagePath = canvasPath.replace("/canvas?", "/image?");
    await page.goto(imagePath);
    await expect(page.getByText("PeterAI 画布", { exact: true })).toBeVisible();
    await page.goto("/");
    await page.setContent(`<iframe style="width:1200px;height:800px" src="http://127.0.0.1:4173${imagePath}"></iframe>`);
    await page.locator("iframe").waitFor();
    const imageFrame = await (await page.locator("iframe").elementHandle())!.contentFrame();
    expect(imageFrame).toBeTruthy();
    await expect(imageFrame!.getByText("生图工作台", { exact: true })).toBeVisible();
    await expect(imageFrame!.getByText("PeterAI 画布", { exact: true })).toHaveCount(0);
});
