import { modelOptionName, resolveModelChannel, type AiConfig } from "@/stores/use-config-store";
import type { PeterPriceTier } from "@/peter/session";
import { normalizePeterImageRequestSize } from "@/peter/image-size";

export type PeterImageEstimate = { tier: PeterPriceTier; count: number; unitPrice: number | null; totalPrice: number | null };

export function estimatePeterImageCost(config: AiConfig): PeterImageEstimate | null {
    const channel = resolveModelChannel(config, config.model || config.imageModel);
    if (channel.source !== "peterai") return null;
    const model = modelOptionName(config.model || config.imageModel);
    const tier = classifyRequestedTier(config.size, config.quality, model);
    const count = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
    const rawPrice = channel.pricesByModel?.[model]?.[tier];
    const unitPrice = typeof rawPrice === "number" && Number.isFinite(rawPrice) ? rawPrice : null;
    return { tier, count, unitPrice, totalPrice: unitPrice === null ? null : unitPrice * count };
}

export function formatPeterImageEstimate(estimate: PeterImageEstimate | null) {
    if (!estimate) return "";
    if (estimate.totalPrice === null) return `预计 ${estimate.count} 张 · ${estimate.tier} · 以实际扣费为准`;
    return `预计 ${estimate.count} 张 × $${trimMoney(estimate.unitPrice || 0)} = $${trimMoney(estimate.totalPrice)} · ${estimate.tier}`;
}

function classifyRequestedTier(size: string, quality: string, model: string): PeterPriceTier {
    const value = (size || "auto").trim().toLowerCase();
    if (value === "1k" || value === "2k" || value === "4k") return value.toUpperCase() as PeterPriceTier;
    const dimensions = value.match(/^(\d+)x(\d+)$/);
    if (dimensions) return tierFromNormalizedSize(model, value);
    if (value === "auto" || !value) return "2K";
    const ratio = value.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
    if (!ratio) return "2K";
    const longRatio = Math.max(Number(ratio[1]), Number(ratio[2])) / Math.min(Number(ratio[1]), Number(ratio[2]));
    const normalizedQuality = quality.toLowerCase();
    const base = normalizedQuality === "low" || normalizedQuality === "standard" || normalizedQuality === "1k" ? 1024 : normalizedQuality === "medium" || normalizedQuality === "hd" || normalizedQuality === "2k" ? 2048 : normalizedQuality === "high" || normalizedQuality === "4k" ? 2880 : 1024;
    const longEdge = normalizedQuality === "auto" || !normalizedQuality ? base * longRatio : Math.sqrt(base * base * longRatio);
    const landscape = Number(ratio[1]) >= Number(ratio[2]);
    const requested = landscape ? `${Math.round(longEdge)}x${Math.round(longEdge / longRatio)}` : `${Math.round(longEdge / longRatio)}x${Math.round(longEdge)}`;
    return tierFromNormalizedSize(model, requested);
}

function tierFromNormalizedSize(model: string, requested: string) {
    const normalized = normalizePeterImageRequestSize(model, requested) || requested;
    const dimensions = normalized.match(/^(\d+)x(\d+)$/);
    return dimensions ? tierFromEdge(Math.max(Number(dimensions[1]), Number(dimensions[2]))) : "2K";
}

function tierFromEdge(edge: number): PeterPriceTier {
    if (edge <= 1024) return "1K";
    if (edge <= 2048) return "2K";
    return "4K";
}

function trimMoney(value: number) {
    return value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "") || "0";
}
