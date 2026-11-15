/** Assemble whatever the cache holds, tolerating gaps and partial matchdays. */
export function loadSeason(store) {
    const meta = store.readMeta();
    const matchdays = [];
    for (const matchday of store.cachedMatchdays()) {
        matchdays.push({
            matchday,
            schedule: store.read('schedule', matchday)?.data.matches,
            bets: store.read('bets', matchday)?.data.matches,
            leaderboard: store.read('leaderboard', matchday)?.data,
            matchdayBets: store.read('matchdayBets', matchday)?.data,
        });
    }
    return {
        community: store.community,
        matchdays,
        knownMatchdays: meta?.knownMatchdays,
        lastSync: meta?.lastSync,
    };
}
/** Matchdays where every match has a final result. */
export function playedMatchdays(season) {
    return season.matchdays.filter((m) => m.schedule?.length && m.schedule.every((s) => /^\d+:\d+$/.test(s.result)));
}
/** Numbers parsed out of the leaderboard's string cells. */
export function toNumber(value) {
    if (value === undefined)
        return null;
    const match = value.replace(',', '.').match(/-?\d+(\.\d+)?/);
    return match ? Number(match[0]) : null;
}
