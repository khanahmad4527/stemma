# Date parser

Turns a genealogical date written the way a source writes it into the four
derived columns, and never touches the verbatim original.

```
abt 1850            → about       1845-01-01 .. 1855-12-31   gregorian
bef 1900            → before      (none)     .. 1899-12-31   gregorian
bet 1852 and 1855   → between     1852-01-01 .. 1855-12-31   gregorian
from 1912 to 1918   → period      1912-01-01 .. 1918-12-31   gregorian
24 Feb 1750/51      → exact       1751-03-07 .. 1751-03-07   julian
12 Mar 1889         → exact       1889-03-12 .. 1889-03-12   gregorian
1889                → about       1889-01-01 .. 1889-12-31   gregorian
Easter 1720         → phrase      (none)     .. (none)       gregorian
```

## Why a date is five columns

A genealogical date is a range with a qualifier, never a date. The register
says *about 1850*, *before 1900*, *between 1852 and 1855*, *24 Feb 1750/51* —
and the only honest storage is the sentence itself plus the range it could
occupy. `date_original` is the evidence. The other four are derived, sortable,
and correctable by hand.

## What it will not do

**Guess.** `12/03/1889` is March or December depending on which side of an
ocean the clerk stood, so it answers `phrase` and keeps the original. `phrase`
is not a failure mode bolted on — it is the model's own word for "the sentence
is all there is". GEDCOM 7 round-trips it as `PHRASE`, it sorts last, and
nothing is lost.

**Overwrite your work.** If the same payload sets any derived column
explicitly, the whole payload is left alone. A researcher who narrowed a range
from the parish register knows more than this does.

**Touch `date_original`.** Ever.

## Two decisions worth knowing

**A bare `1889` becomes `about`, not `exact`.** The database CHECK says `exact`
requires `earliest = latest`, so `exact` is only ever a whole day. A
year-precision record is a range, and `about` is the vocabulary's word for a
range around a point. `seed.ts`'s `inYear()` helper decided this before the
parser existed.

**The Julian shift applies at day and month precision, not year.** The offset
is 10–13 days; a year-precision record is already uncertain by 365. Converting
anyway turns `1750/51` into `1751-01-12 .. 1752-01-11` — arithmetically right,
since a Julian year really does straddle two Gregorian ones, and useless.

## How it is wired

A **filter** hook, not an action: it runs before the row is written, so the
four columns land in the same `INSERT` as the original — one write, one
revision, and the database CHECK sees a finished row. An action hook would
need a second `UPDATE`, doubling revisions and leaving a window where a row
exists with an unparsed date.

The collections it covers are a literal in `src/index.ts`, because an
extension cannot import from the bootstrap package. `verify.ts` compares that
literal against the collections that actually have a `date_original` column,
so adding `dated()` somewhere new and forgetting the hook fails the suite
instead of silently leaving those dates unparsed.

## Build

```bash
pnpm build:extensions     # then restart Directus — dist/ is read at boot
```

Licensed under PolyForm Strict 1.0.0. See `LICENSE`.
