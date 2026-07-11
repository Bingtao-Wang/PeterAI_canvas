import { imageToDataUrl } from "@/services/image-storage";
import { modelOptionName } from "@/stores/use-config-store";
import { clearPeterSession, getPeterSession } from "@/peter/session";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export async function publishCanvasImage(node: CanvasNodeData) {
    const session = getPeterSession();
    if (!session?.token) throw new Error("PeterAI 登录已失效，请重新进入画布");
    if (node.type !== CanvasNodeType.Image || !node.metadata?.content || node.metadata.status === "error" || node.metadata.status === "loading") throw new Error("当前节点没有可发布的成功图片");
    const prompt = node.metadata.prompt?.trim();
    if (!prompt) throw new Error("图片缺少提示词，无法发布到画廊");
    const imageData = await imageToDataUrl({ url: node.metadata.content, storageKey: node.metadata.storageKey });
    if (!imageData?.startsWith("data:image/")) throw new Error("图片数据读取失败");
    const thumbData = await createThumbnail(imageData);
    const response = await fetch("/peter-api/api/v1/gallery/items", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.token}`, Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
            image_data: imageData,
            thumb_data: thumbData,
            prompt,
            revised_prompt: "",
            model: modelOptionName(node.metadata.model || ""),
            size: node.metadata.size || "",
            quality: node.metadata.quality || "",
            format: mimeFormat(node.metadata.mimeType || imageData.slice(5, imageData.indexOf(";"))),
            mode: node.metadata.generationType === "edit" ? "image" : "text",
        }),
    });
    const payload = (await response.json().catch(() => null)) as { data?: Array<{ id?: number }> | { id?: number }; message?: string; error?: { message?: string } } | null;
    if (!response.ok) {
        if (response.status === 401) clearPeterSession();
        throw new Error(response.status === 401 ? "PeterAI 登录已失效，请重新进入画布" : payload?.message || payload?.error?.message || `发布失败（${response.status}）`);
    }
    const data = payload?.data;
    const item = Array.isArray(data) ? data[0] : data;
    return Number(item?.id || 0);
}

function createThumbnail(dataUrl: string) {
    return new Promise<string>((resolve) => {
        const image = new Image();
        image.onload = () => {
            const scale = Math.min(1, 360 / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
            canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
            const context = canvas.getContext("2d");
            if (!context) return resolve("");
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL("image/jpeg", 0.78));
        };
        image.onerror = () => resolve("");
        image.src = dataUrl;
    });
}

function mimeFormat(mimeType: string) {
    if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpeg";
    if (mimeType.includes("webp")) return "webp";
    return "png";
}
