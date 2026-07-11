export const PETER_IMAGE_MAX_CONCURRENCY = 4;

type QueuedImageTask = {
    run: () => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
};

const imageQueue: QueuedImageTask[] = [];
let activeImageTasks = 0;

export function runImageTask<R>(task: () => Promise<R>): Promise<R> {
    return new Promise<R>((resolve, reject) => {
        imageQueue.push({ run: task, resolve: (value) => resolve(value as R), reject });
        drainImageQueue();
    });
}

function drainImageQueue() {
    while (activeImageTasks < PETER_IMAGE_MAX_CONCURRENCY && imageQueue.length) {
        const task = imageQueue.shift()!;
        activeImageTasks += 1;
        void task.run().then(task.resolve, task.reject).finally(() => {
            activeImageTasks -= 1;
            drainImageQueue();
        });
    }
}

export async function runWithConcurrency<T, R>(items: readonly T[], concurrency: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length);
    let nextIndex = 0;
    const workerCount = Math.max(1, Math.min(Math.floor(concurrency) || 1, items.length));
    await Promise.all(
        Array.from({ length: workerCount }, async () => {
            while (nextIndex < items.length) {
                const index = nextIndex++;
                results[index] = await task(items[index], index);
            }
        }),
    );
    return results;
}
