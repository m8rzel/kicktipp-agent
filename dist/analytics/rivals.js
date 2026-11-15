import { classify, parseScore, pointsFor, } from '../rules/scoring.js';
/**
 * Representative scorelines standing in for the ways a match can end.
 *
 * Scenarios are about outcome classes, not exact scores: what matters is
 * whether each side's prediction lands as exact, right difference, right
 * tendency or nothing. This set is enough to expose every distinction the
 * scoring rules can make, while keeping the search space tiny.
 */
const OUTCOME_SAMPLES = [
    { home: 1, away: 0 },
    { home: 2, away: 0 },
    { home: 2, away: 1 },
    { home: 3, away: 1 },
    { home: 0, away: 0 },
    { home: 1, away: 1 },
    { home: 2, away: 2 },
    { home: 0, away: 1 },
    { home: 0, away: 2 },
    { home: 1, away: 2 },
    { home: 1, away: 3 },
];
function outcomeOf(score) {
    if (score.home > score.away)
        return 'home';
    if (score.home < score.away)
        return 'away';
    return 'draw';
}
function pointsAgainst(bet, result, rules) {
    return bet ? pointsFor(classify(bet, result), rules) : 0;
}
/**
 * How much this match can move the gap, per outcome class and overall.
 *
 * With the rival's bet unknown, the calculation switches to the widest
 * plausible range: the rival is assumed to score their maximum in the worst
 * case and nothing in the best case.
 */
export function matchSwing(match, myBet, rivalBet, rules, rivalKnown) {
    const mine = parseScore(myBet);
    const theirs = parseScore(rivalBet);
    const settledResult = parseScore(match.result);
    if (settledResult) {
        const delta = pointsAgainst(mine, settledResult, rules) - pointsAgainst(theirs, settledResult, rules);
        return {
            home: match.home,
            away: match.away,
            myBet,
            rivalBet,
            bestForMe: delta,
            worstForMe: delta,
            settled: delta,
        };
    }
    const byOutcome = {
        home: { best: -Infinity, worst: Infinity },
        draw: { best: -Infinity, worst: Infinity },
        away: { best: -Infinity, worst: Infinity },
    };
    for (const sample of OUTCOME_SAMPLES) {
        const myPoints = pointsAgainst(mine, sample, rules);
        // Without the rival's bet, bound their score by what any bet could earn.
        const rivalPoints = rivalKnown ? pointsAgainst(theirs, sample, rules) : rules.exact;
        const rivalFloor = rivalKnown ? rivalPoints : 0;
        const outcome = outcomeOf(sample);
        byOutcome[outcome].best = Math.max(byOutcome[outcome].best, myPoints - rivalFloor);
        byOutcome[outcome].worst = Math.min(byOutcome[outcome].worst, myPoints - rivalPoints);
    }
    const all = Object.values(byOutcome);
    return {
        home: match.home,
        away: match.away,
        myBet,
        rivalBet,
        bestForMe: Math.max(...all.map((o) => o.best)),
        worstForMe: Math.min(...all.map((o) => o.worst)),
        byOutcome: rivalKnown ? byOutcome : undefined,
    };
}
function describeFinished(rival, startingGap) {
    if (startingGap === null) {
        return 'This matchday is finished. Standings for the gap are not cached.';
    }
    if (startingGap > 0) {
        return `This matchday is finished. You finished ${startingGap} ahead of ${rival}.`;
    }
    if (startingGap < 0) {
        return `This matchday is finished. You finished ${-startingGap} behind ${rival}.`;
    }
    return `This matchday is finished. You finished level with ${rival}.`;
}
function describeWithoutTips(rival, startingGap) {
    if (startingGap === null) {
        return 'Bets are not in yet, so there is no swing to compute.';
    }
    if (startingGap > 0) {
        return `You are ${startingGap} ahead going into this matchday. Bets are not in yet, so nothing can swing.`;
    }
    if (startingGap < 0) {
        return `You trail ${rival} by ${-startingGap} going into this matchday. Bets are not in yet, so nothing can swing.`;
    }
    return `You and ${rival} are level going into this matchday. Bets are not in yet, so nothing can swing.`;
}
function describe(swing) {
    if (!swing.byOutcome)
        return null;
    const gains = ['home', 'draw', 'away']
        .filter((o) => swing.byOutcome[o].best > 0)
        .map((o) => (o === 'home' ? `${swing.home} win` : o === 'away' ? `${swing.away} win` : 'a draw'));
    if (!gains.length)
        return null;
    return `${swing.home} vs ${swing.away}: you gain on ${gains.join(' or ')}`;
}
/**
 * Compare two players over one matchday: where the gap stands, how much each
 * remaining match can move it, and what would have to happen to close it.
 */
export function analyseRival(grid, player, rival, rules, gapBefore) {
    const mine = grid.players.find((p) => p.player === player);
    const theirs = grid.players.find((p) => p.player === rival);
    const rivalKnown = Boolean(mine && theirs);
    const mode = rivalKnown ? 'exact' : 'bounds';
    const perMatch = grid.matches.map((match, i) => matchSwing(match, mine?.bets[i] ?? null, theirs?.bets[i] ?? null, rules, rivalKnown));
    const open = perMatch.filter((m) => m.settled === undefined);
    const settledDelta = perMatch
        .filter((m) => m.settled !== undefined)
        .reduce((sum, m) => sum + m.settled, 0);
    const swingRange = {
        best: open.reduce((sum, m) => sum + m.bestForMe, 0),
        worst: open.reduce((sum, m) => sum + m.worstForMe, 0),
    };
    const startingGap = gapBefore === null ? null : gapBefore + settledDelta;
    const anyTip = perMatch.some((m) => m.myBet || m.rivalBet);
    const conditions = [];
    if (!anyTip) {
        conditions.push(describeWithoutTips(rival, startingGap));
    }
    else if (open.length === 0) {
        conditions.push(describeFinished(rival, startingGap));
    }
    else if (startingGap === null) {
        conditions.push('Standings for this matchday are not cached, so only the swing range is known.');
    }
    else if (startingGap > 0) {
        conditions.push(swingRange.worst + startingGap > 0
            ? `You stay ahead whatever happens (worst case still +${startingGap + swingRange.worst}).`
            : `You are ${startingGap} ahead, but can still be caught (worst case ${startingGap + swingRange.worst}).`);
    }
    else if (startingGap === 0) {
        conditions.push(swingRange.best > 0
            ? `You are level; out-scoring ${rival} by 1 would take the lead, and up to ${swingRange.best} is available.`
            : `You are level, and the remaining matches cannot change that.`);
    }
    else {
        const needed = -startingGap;
        conditions.push(swingRange.best > needed
            ? `You need to out-score ${rival} by ${needed + 1} across the open matches; up to ${swingRange.best} is available.`
            : `Catching ${rival} is out of reach this matchday: you trail by ${needed} and at most ${swingRange.best} is available.`);
    }
    for (const swing of open) {
        const line = describe(swing);
        if (line)
            conditions.push(line);
    }
    return {
        rival,
        player,
        matchday: grid.matchday,
        mode,
        gap: startingGap,
        perMatch,
        swingRange,
        conditions,
        note: grid.note ??
            (rivalKnown
                ? undefined
                : `${rival}'s bets are not visible yet, so these are best/worst bounds rather than exact swings.`),
    };
}
