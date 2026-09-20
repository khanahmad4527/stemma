/**
 * The date-parsing hook.
 *
 * A `filter` and not an `action`, deliberately. A filter runs *before*
 * the row is written and returns the payload it wants written, so the
 * four derived columns land in the same INSERT as `date_original` — one
 * write, one revision, and the database CHECK sees the finished row. An
 * action hook would have to issue a second UPDATE afterwards, which
 * doubles the revisions, races anything reading in between, and leaves a
 * window where a row exists with an unparsed date.
 *
 * ── Three rules about not destroying work ──────────────────────────────
 *
 * **`date_original` is never written.** It is the evidence. This hook
 * only ever reads it.
 *
 * **A hand correction wins.** The derived columns are meant to be
 * correctable — a researcher who knows the parish register says March
 * should be able to narrow the range and have it stick. So if the same
 * payload sets any derived column explicitly, the whole payload is left
 * alone. The person editing is better informed than the parser.
 *
 * **Clearing the original clears what was derived from it.** Otherwise a
 * row keeps a range whose source has been deleted, which is a fact with
 * no evidence behind it. `date_calendar` survives, because that is a
 * property of the record's tradition rather than of the one sentence.
 */
import { defineHook } from "@directus/extensions-sdk";
import { parseDate, type Calendar } from "./parse.js";

/**
 * Collections carrying the five-column date — everything that uses
 * `dated()` in `bootstrap/src/authoring/`.
 *
 * Hard-coded because a hook cannot import from the bootstrap package, so
 * `verify.ts` asserts this list still matches the collections that
 * actually have a `date_original` column. Add `dated()` somewhere new and
 * forget this, and the suite says so rather than the dates silently
 * staying unparsed.
 */
const DATED = ["events", "associations", "media"] as const;

const DERIVED = ["date_qualifier", "date_earliest", "date_latest", "date_calendar"] as const;

type Payload = Record<string, unknown>;

export default defineHook(({ filter }, { logger }) => {
  const fill = (input: unknown, collection: string): unknown => {
    if (!input || typeof input !== "object" || Array.isArray(input)) return input;
    if (!(DATED as readonly string[]).includes(collection)) return input;

    const payload = input as Payload;
    if (!("date_original" in payload)) return payload;

    // The editor said something about the derived columns themselves.
    // Whatever they said, they know more than this does.
    if (DERIVED.some((k) => k in payload)) return payload;

    const original = payload["date_original"];
    if (original === null || original === undefined || String(original).trim() === "") {
      return { ...payload, date_qualifier: null, date_earliest: null, date_latest: null };
    }

    try {
      const existing = payload["date_calendar"];
      const parsed = parseDate(
        String(original),
        typeof existing === "string" ? (existing as Calendar) : "gregorian",
      );
      return {
        ...payload,
        date_qualifier: parsed.qualifier,
        date_earliest: parsed.earliest,
        date_latest: parsed.latest,
        date_calendar: parsed.calendar,
      };
    } catch (error) {
      // Never block a write over a date. The original is already safe in
      // the payload, and `phrase` is the model's word for "the sentence
      // is all there is" — which, after a parser crash, it is.
      logger.warn(`date-parser: "${String(original)}" on ${collection} — ${String(error)}`);
      return { ...payload, date_qualifier: "phrase", date_earliest: null, date_latest: null };
    }
  };

  filter("items.create", (payload, meta) => fill(payload, String(meta["collection"] ?? "")));
  filter("items.update", (payload, meta) => fill(payload, String(meta["collection"] ?? "")));
});
