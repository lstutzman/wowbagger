// The attention layer: the open items a reader must act on rather than merely
// look at. Blocked work names its blockers, aging work names its age, and
// started work is measured against what this ledger's own history says work
// normally takes.
import { daysBetween } from './report-sequencing.js';

// Each attention list is a call to act, so it stays short enough to read. The
// full set is always one section further down, in the drill-down.
const LIST_LIMIT = 10;

export function buildAttention(openItems, terminalItems, cycleTime, asOf) {
  const blocked = buildBlocked(openItems, terminalItems, asOf);
  const aging = buildAging(openItems, asOf);
  const stuck = buildStuck(openItems, cycleTime, asOf);

  return {
    blocked: blocked.slice(0, LIST_LIMIT),
    blockedTotal: blocked.length,
    aging: aging.slice(0, LIST_LIMIT),
    agingTotal: aging.length,
    stuck: stuck.slice(0, LIST_LIMIT),
    stuckTotal: stuck.length,
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
    .sort((left, right) => right.ageDays - left.ageDays || compareText(left.id, right.id));
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

// A blocker is named by its number, never by its ULID: the reader has to be
// able to say it out loud.
function buildBlocked(openItems, terminalItems, asOf) {
  const byId = new Map([...openItems, ...terminalItems].map((item) => [item.id, item]));

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
