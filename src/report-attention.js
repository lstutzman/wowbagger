// The attention layer: the open items a reader must act on rather than merely
// look at. Blocked work names its blockers, aging work names its age, and
// started work is measured against what this ledger's own history says work
// normally takes.
import { daysBetween } from './report-sequencing.js';

const AGING_LIMIT = 10;

export function buildAttention(openItems, cycleTime, asOf) {
  return {
    blocked: buildBlocked(openItems, asOf),
    aging: buildAging(openItems, asOf),
    stuck: buildStuck(openItems, cycleTime, asOf),
  };
}

// Work item age against this ledger's own 85th-percentile cycle time. Vacanti's
// leading indicator: an item already older than 85 percent of everything that
// finished is the one to ask about. `backlog -> in-progress` records no
// decision, so elapsed time is measured from the accept decision, which is the
// earliest reliable start the ledger carries. With no cycle-time history there
// is no threshold and nothing is flagged.
function buildStuck(openItems, cycleTime, asOf) {
  const thresholdDays = cycleTime.p85Days;
  if (thresholdDays === null) {
    return [];
  }

  return openItems
    .filter((item) => item.status === 'in-progress')
    .map((item) => {
      const accepted = item.decisions.find((decision) => decision.action === 'accept');
      const startedOn = accepted?.date ?? item.created;
      return {
        id: item.id,
        number: item.number,
        title: item.title,
        status: item.status,
        startedOn,
        elapsedDays: daysBetween(startedOn, asOf) ?? 0,
        thresholdDays,
      };
    })
    .filter((entry) => entry.elapsedDays > thresholdDays)
    .sort((left, right) => right.elapsedDays - left.elapsedDays || compareText(left.id, right.id));
}

// The oldest open items, whatever their readiness. Age is the single
// highest-signal backlog metric and the report has to name the number of days,
// not a vague "stale" badge.
function buildAging(openItems, asOf) {
  return openItems
    .map((item) => ({
      id: item.id,
      number: item.number,
      title: item.title,
      status: item.status,
      state: item.readiness.state,
      ageDays: daysBetween(item.created, asOf) ?? 0,
    }))
    .sort((left, right) => right.ageDays - left.ageDays || compareText(left.id, right.id))
    .slice(0, AGING_LIMIT);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

// A blocker is named by its number, never by its ULID: the reader has to be
// able to say it out loud.
function buildBlocked(openItems, asOf) {
  const byId = new Map(openItems.map((item) => [item.id, item]));

  return openItems
    .filter((item) => item.readiness.state === 'blocked')
    .map((item) => ({
      id: item.id,
      number: item.number,
      title: item.title,
      ageDays: daysBetween(item.created, asOf) ?? 0,
      blockers: item.readiness.reasons
        .filter((reason) => reason.item_id !== undefined)
        .map((reason) => {
          const blocker = byId.get(reason.item_id);
          return {
            code: reason.code,
            id: reason.item_id,
            number: blocker?.number ?? null,
            title: blocker?.title ?? null,
            status: blocker?.status ?? null,
          };
        }),
    }));
}
