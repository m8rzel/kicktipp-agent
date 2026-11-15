import { classify, parseScore, tendencyOf } from '../rules/scoring.js';
import { toNumber } from './season.js';
function mean(values) {
    if (!values.length)
        return null;
    return values.reduce((a, b) => a + b, 0) / values.length;
}
function standardDeviation(values) {
    const m = mean(values);
    if (m === null || values.length < 2)
        return null;
    const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length;
    return Math.sqrt(variance);
}
function rowFor(md, player) {
    return md.leaderboard?.rankings.find((r) => r.name === player);
}
/** Points scored by everyone that matchday, for the league average. */
function leagueAverageFor(md) {
    const points = (md.leaderboard?.rankings ?? [])
        .map((r) => toNumber(r.matchdayPoints))
        .filter((n) => n !== null);
    return mean(points);
}
function buildForm(season, player) {
    return season.matchdays
        .filter((md) => md.leaderboard)
        .map((md) => {
        const row = rowFor(md, player);
        return {
            matchday: md.matchday,
            points: row ? toNumber(row.matchdayPoints) : null,
            leagueAverage: leagueAverageFor(md),
            rank: row ? toNumber(row.position) : null,
        };
    });
}
function rollingAverage(form, window) {
    return form.map((_, i) => {
        const slice = form
            .slice(Math.max(0, i - window + 1), i + 1)
            .map((f) => f.points)
            .filter((p) => p !== null);
        return slice.length ? mean(slice) : null;
    });
}
function rankMoves(form) {
    let climb = null;
    let drop = null;
    for (let i = 1; i < form.length; i++) {
        const from = form[i - 1].rank;
        const to = form[i].rank;
        if (from === null || to === null)
            continue;
        // Rank 1 is best, so a fall in the number is a climb up the table.
        const delta = from - to;
        const move = { matchday: form[i].matchday, from, to, delta };
        if (delta > 0 && (!climb || delta > climb.delta))
            climb = move;
        if (delta < 0 && (!drop || delta < drop.delta))
            drop = move;
    }
    return { climb, drop };
}
/**
 * One player's predictions paired with the final results.
 *
 * The per-player bet grid is preferred, because it covers everybody. The
 * cached bets page only ever holds the logged-in user's own predictions, so
 * it is used only when the player asked about *is* that user — otherwise
 * another player's breakdown would silently be built from your bets.
 */
function scoredPairs(season, player, ownPlayer) {
    const pairs = [];
    let matchdaysUsed = 0;
    for (const md of season.matchdays) {
        const grid = md.matchdayBets;
        const row = grid?.players.find((p) => p.player === player);
        if (grid && row) {
            let used = false;
            row.bets.forEach((bet, i) => {
                const match = grid.matches[i];
                if (!match || !parseScore(bet) || !parseScore(match.result))
                    return;
                pairs.push({ bet, result: match.result });
                used = true;
            });
            if (used)
                matchdaysUsed++;
            continue;
        }
        if (player !== ownPlayer || !md.bets || !md.schedule)
            continue;
        let used = false;
        for (const bet of md.bets) {
            const match = md.schedule.find((s) => s.home === bet.home && s.away === bet.away);
            if (!match)
                continue;
            if (!parseScore(bet.bet) || !parseScore(match.result))
                continue;
            pairs.push({ bet: bet.bet, result: match.result });
            used = true;
        }
        if (used)
            matchdaysUsed++;
    }
    return { pairs, matchdaysUsed };
}
function buildBreakdown(pairs, rules) {
    const counts = { exact: 0, goalDiff: 0, tendency: 0, miss: 0 };
    let points = 0;
    for (const { bet, result } of pairs) {
        const b = parseScore(bet);
        const r = parseScore(result);
        const kind = classify(b, r);
        counts[kind]++;
        if (kind === 'exact')
            points += rules.exact;
        else if (kind === 'goalDiff')
            points += rules.goalDiff;
        else if (kind === 'tendency')
            points += rules.tendency;
    }
    return { ...counts, scored: pairs.length, points };
}
function buildBetProfile(pairs) {
    const predicted = { home: 0, draw: 0, away: 0 };
    const actual = { home: 0, draw: 0, away: 0 };
    const scorelines = new Map();
    let predictedGoals = 0;
    let actualGoals = 0;
    for (const { bet, result } of pairs) {
        const b = parseScore(bet);
        const r = parseScore(result);
        predicted[tendencyOf(b)]++;
        actual[tendencyOf(r)]++;
        predictedGoals += b.home + b.away;
        actualGoals += r.home + r.away;
        const key = `${b.home}:${b.away}`;
        scorelines.set(key, (scorelines.get(key) ?? 0) + 1);
    }
    const total = pairs.length;
    const share = (n) => (total ? n / total : 0);
    const favourite = [...scorelines.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
        predicted: { home: share(predicted.home), draw: share(predicted.draw), away: share(predicted.away) },
        actual: { home: share(actual.home), draw: share(actual.draw), away: share(actual.away) },
        averagePredictedGoals: total ? predictedGoals / total : null,
        averageActualGoals: total ? actualGoals / total : null,
        favouriteScoreline: favourite ? favourite[0] : null,
    };
}
function buildConsistency(form) {
    const scored = form.filter((f) => f.points !== null);
    const points = scored.map((f) => f.points);
    const comparable = scored.filter((f) => f.leagueAverage !== null);
    const below = comparable.filter((f) => f.points < f.leagueAverage);
    const sorted = [...scored].sort((a, b) => b.points - a.points);
    return {
        mean: mean(points),
        standardDeviation: standardDeviation(points),
        best: sorted[0] ?? null,
        worst: sorted[sorted.length - 1] ?? null,
        belowAverageShare: comparable.length ? below.length / comparable.length : null,
    };
}
/**
 * Everything `kicktipp stats` reports, computed from cached data only.
 *
 * Pure: no I/O, no clock. Metrics degrade independently — a season with
 * leaderboards but no cached bets still yields form and rank history, and
 * `completeness` says exactly how much data each part rests on.
 */
export function computeSeasonStats(season, player, rules, ownPlayer = player) {
    const form = buildForm(season, player);
    const { pairs, matchdaysUsed } = scoredPairs(season, player, ownPlayer);
    const { climb, drop } = rankMoves(form);
    const played = season.matchdays.filter((m) => m.schedule?.length && m.schedule.every((s) => /^\d+:\d+$/.test(s.result))).length;
    return {
        community: season.community,
        player,
        form,
        rolling5: rollingAverage(form, 5),
        biggestClimb: climb,
        biggestDrop: drop,
        breakdown: buildBreakdown(pairs, rules),
        betProfile: buildBetProfile(pairs),
        consistency: buildConsistency(form),
        rulesUsed: rules,
        completeness: {
            cachedMatchdays: season.matchdays.length,
            playedMatchdays: played,
            knownMatchdays: season.knownMatchdays ?? null,
            withLeaderboard: form.length,
            withBets: matchdaysUsed,
            lastSync: season.lastSync ?? null,
        },
    };
}
