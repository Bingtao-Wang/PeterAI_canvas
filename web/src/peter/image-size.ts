export function normalizePeterImageRequestSize(model: string, requestedSize: string | undefined) {
    if (!requestedSize) return undefined;
    const value = model.toLowerCase();
    const dimensions = requestedSize.match(/^(\d+)x(\d+)$/);
    if (!dimensions) return requestedSize;
    const width = Number(dimensions[1]);
    const height = Number(dimensions[2]);
    const orientation = width === height ? "square" : width > height ? "landscape" : "portrait";
    if (value.startsWith("dall-e-2")) return width <= 256 && height <= 256 ? "256x256" : width <= 512 && height <= 512 ? "512x512" : "1024x1024";
    if (value.startsWith("dall-e-3")) return orientation === "landscape" ? "1792x1024" : orientation === "portrait" ? "1024x1792" : "1024x1024";
    if (value.startsWith("gpt-image") || value.startsWith("chatgpt-image")) return orientation === "landscape" ? "1536x1024" : orientation === "portrait" ? "1024x1536" : "1024x1024";
    return requestedSize;
}
