export class OfflineCacheMiss extends Error {
}
/**
 * Run a live fetch and write the result to the cache, or — in offline mode —
 * serve the cached copy instead.
 *
 * The cache is a history, not a bypass: online reads always go to Kicktipp so
 * commands keep showing live data, and the snapshot is a side effect.
 */
export async function throughCache(kind, matchday, opts, live) {
    const { store, offline } = opts;
    if (offline) {
        const cached = store?.read(kind, matchday);
        if (!cached) {
            const where = matchday === undefined ? kind : `${kind} for matchday ${matchday}`;
            throw new OfflineCacheMiss(`No cached ${where}. Run \`kicktipp sync\` while online, or drop --offline.`);
        }
        return cached.data;
    }
    const data = await live();
    if (store) {
        try {
            store.write(kind, data, matchday);
        }
        catch {
            // A cache that cannot be written must never break the command the user
            // actually asked for.
        }
    }
    return data;
}
