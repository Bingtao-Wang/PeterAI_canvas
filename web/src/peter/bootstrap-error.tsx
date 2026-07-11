export function PeterBootstrapError({ message }: { message: string }) {
    return (
        <main className="grid min-h-dvh place-items-center bg-stone-50 px-6 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
            <section className="w-full max-w-lg rounded-2xl border border-stone-200 bg-white p-8 text-center shadow-sm dark:border-stone-800 dark:bg-stone-900">
                <h1 className="text-2xl font-semibold">PeterAI 画布</h1>
                <p className="mt-4 text-sm leading-6 text-stone-500">{message}</p>
                <a className="mt-6 inline-flex rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600" href="https://api.peterai.cc.cd/">
                    返回 PeterAI
                </a>
                <p className="mt-6 text-xs text-stone-400">
                    基于 <a className="underline" href="https://github.com/basketikun/infinite-canvas" target="_blank" rel="noreferrer">Infinite Canvas</a> · AGPL-3.0
                </p>
            </section>
        </main>
    );
}
