import { expect, test } from "@playwright/test";

const canvasPathFor = (token: string) => `/canvas?mode=recent&token=${encodeURIComponent(token)}&src_host=https%3A%2F%2Fapi.peterai.cc.cd&ui_mode=embedded&user_id=999`;
const canvasPath = canvasPathFor("e2e-jwt");

test.beforeEach(async ({ page }) => {
    await page.route("**/peter-api/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith("/auth/me")) {
            const userId = route.request().headers().authorization === "Bearer e2e-jwt-b" ? 43 : 42;
            return route.fulfill({ json: { code: 0, data: { id: userId, username: `e2e-${userId}` } } });
        }
        if (path.endsWith("/keys")) return route.fulfill({ json: { code: 0, data: { items: [] } } });
        if (path.endsWith("/image-generation/options")) return route.fulfill({ json: { code: 0, data: { keys: [] } } });
        if (path.endsWith("/channels/available")) return route.fulfill({ json: { code: 0, data: [] } });
        return route.fulfill({ status: 404, json: { error: { message: "not found" } } });
    });
});

test("keeps canvas projects isolated when the verified PeterAI user changes", async ({ page }) => {
    await page.goto(canvasPathFor("e2e-jwt-a"));
    const initialTitle = page.getByTitle("双击修改画布名称");
    await expect(initialTitle).toBeVisible();
    await initialTitle.dblclick();
    await page.locator('input[value="无限画布 1"]').fill("用户A私有画布");
    await page.locator('input[value="用户A私有画布"]').press("Enter");
    await expect(page.getByText("用户A私有画布", { exact: true })).toBeVisible();
    await page.waitForTimeout(700);

    await page.goto(canvasPathFor("e2e-jwt-b"));
    await expect(page.getByText("用户A私有画布", { exact: true })).toHaveCount(0);
    await expect(page.getByTitle("双击修改画布名称")).toHaveText("无限画布 1");

    await page.goto(canvasPathFor("e2e-jwt-a"));
    await expect(page.getByText("用户A私有画布", { exact: true })).toBeVisible();
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
