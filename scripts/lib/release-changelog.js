// Changelog structure for a cut.
//
// The two previous cuts renamed `## Unreleased` into the release heading, so
// the file shipped with no bucket for the next change and later work landed
// under an already published release. A cut therefore never renames: it opens a
// fresh empty `## Unreleased` and files the released notes under a new heading
// directly beneath it.

const UNRELEASED_HEADING = /^## Unreleased[ \t]*$/gm;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isCalendarDay(date) {
  const match = ISO_DAY.exec(date ?? '');
  if (match === null) return false;
  const [, year, month, day] = match;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime())
    && parsed.getUTCFullYear() === Number(year)
    && parsed.getUTCMonth() + 1 === Number(month)
    && parsed.getUTCDate() === Number(day);
}

/**
 * @returns {{ok: boolean, problems: Array<{code: string, detail: string}>, text?: string}}
 */
export function rewriteChangelog({ text, version, date }) {
  if (!isCalendarDay(date)) {
    return {
      ok: false,
      problems: [{ code: 'date-invalid', detail: `--date must be an ISO calendar day, not ${date}` }],
    };
  }

  const headings = [...text.matchAll(UNRELEASED_HEADING)];
  if (headings.length === 0) {
    return {
      ok: false,
      problems: [{ code: 'unreleased-missing', detail: 'CHANGELOG.md has no `## Unreleased` section' }],
    };
  }
  if (headings.length > 1) {
    return {
      ok: false,
      problems: [{
        code: 'unreleased-duplicate',
        detail: `CHANGELOG.md has ${headings.length} \`## Unreleased\` sections`,
      }],
    };
  }

  const releaseHeading = `## ${version} - ${date}`;
  if (new RegExp(`^## ${version.replaceAll('.', '\\.')} `, 'm').test(text)) {
    return {
      ok: false,
      problems: [{
        code: 'release-section-present',
        detail: `CHANGELOG.md already carries a ${version} section`,
      }],
    };
  }

  const [heading] = headings;
  const bodyStart = heading.index + heading[0].length;
  const nextHeading = /^## /m.exec(text.slice(bodyStart));
  const body = nextHeading === null
    ? text.slice(bodyStart)
    : text.slice(bodyStart, bodyStart + nextHeading.index);
  if (body.trim() === '') {
    return {
      ok: false,
      problems: [{
        code: 'unreleased-empty',
        detail: 'a release needs notes: `## Unreleased` is empty',
      }],
    };
  }

  return {
    ok: true,
    problems: [],
    text: `${text.slice(0, heading.index)}## Unreleased\n\n${releaseHeading}${text.slice(bodyStart)}`,
  };
}
