/** Kicktipp's out-of-the-box scheme, used when nothing better is known. */
export const DEFAULT_RULES = { exact: 4, goalDiff: 3, tendency: 2 };
/** The multiplier a matchday's points are scaled by, default 1. */
export function multiplierFor(matchday, rules) {
    if (matchday == null)
        return 1;
    return rules.multipliers?.[matchday] ?? 1;
}
/** '2:1' → {home:2, away:1}; anything else → null. */
export function parseScore(value) {
    const match = String(value ?? '').match(/^\s*(\d+)\s*[:\-]\s*(\d+)\s*$/);
    if (!match)
        return null;
    return { home: Number(match[1]), away: Number(match[2]) };
}
export function tendencyOf(score) {
    if (score.home > score.away)
        return 'home';
    if (score.home < score.away)
        return 'away';
    return 'draw';
}
/** Which tier a prediction lands in. */
export function classify(bet, result) {
    if (bet.home === result.home && bet.away === result.away)
        return 'exact';
    if (tendencyOf(bet) !== tendencyOf(result))
        return 'miss';
    // A predicted draw that is not the exact draw only ever scores tendency:
    // every draw has goal difference zero, so "right difference" would be the
    // same thing twice.
    if (tendencyOf(bet) === 'draw')
        return 'tendency';
    if (bet.home - bet.away === result.home - result.away)
        return 'goalDiff';
    return 'tendency';
}
export function pointsFor(kind, rules) {
    switch (kind) {
        case 'exact':
            return rules.exact;
        case 'goalDiff':
            return rules.goalDiff;
        case 'tendency':
            return rules.tendency;
        default:
            return 0;
    }
}
/** Points a single prediction earns against a final result. */
export function scoreBet(bet, result, rules) {
    const b = typeof bet === 'string' || bet == null ? parseScore(bet) : bet;
    const r = typeof result === 'string' || result == null ? parseScore(result) : result;
    if (!b || !r)
        return 0;
    return pointsFor(classify(b, r), rules);
}
