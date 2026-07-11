const DEFAULT_SCOPE = "guest";

let activeScope = DEFAULT_SCOPE;

export function setStorageUserId(userId: string | number) {
    const value = String(userId).trim();
    if (!/^\d+$/.test(value)) throw new Error("PeterAI 用户 ID 无效");
    activeScope = value;
}

export function resetStorageScope() {
    activeScope = DEFAULT_SCOPE;
}

export function getStorageScope() {
    return `peterai-canvas:${activeScope}`;
}

export function getStorageDatabaseName() {
    return getStorageScope();
}

export function scopedStorageKey(key: string) {
    return `${getStorageScope()}:${key}`;
}
