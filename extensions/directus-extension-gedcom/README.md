# GEDCOM 7 export

```
GET /gedcom/:slug        →  kowalski.ged
```

Downloads a tree as GEDCOM 7 — the format Ancestry, FamilySearch, Gramps,
RootsMagic and everything else reads.

## The one hard problem

GEDCOM makes a **family** the node and hangs people off it. This schema does
the opposite, deliberately: people are nodes, `couples` and `parentage` are
edges, and no `FAM` row exists to export. That decision is what lets a child
have two biological and two adoptive parents on record without inventing a
family that never existed.

So families are **derived at export time**, the same way the descendant chart
derives them at render time. A drawing needs a family and so does GEDCOM;
neither is allowed to make the storage grow one.

1. Every `couples` row becomes a family, children or not — a childless
   marriage is still a marriage.
2. A child's parent edges are grouped **by lineage**, so a child adopted by
   one couple and born to another gets two `FAMC` links with a `PEDI` on each.
3. Two parents make a pair; one parent makes a single-parent family, which
   GEDCOM permits.
4. **Three or more parents in one lineage** — which this model allows and
   GEDCOM's one-`HUSB`-one-`WIFE` record does not — are split across families
   and the child links to all of them. Nothing is dropped; the shape is just
   flatter than the original.

## Privacy is not this extension's job

Everything is read through `ItemsService` carrying `req.accountability`, so
**the caller's own permissions decide what lands in the file**. A member gets
their tree. An anonymous caller gets what the public policy grants — the dead
of a public tree, and nothing naming anybody living.

That is the whole security design. Querying Postgres directly and filtering
here would put a second, hand-written copy of the privacy boundary inside an
export, and the first time the two disagreed it would be a living person's
birth date in a file somebody emailed.

`verify.ts` proves it both ways: the living person is in a member's export and
absent from the anonymous one, and the check is gated on the anonymous export
actually returning people, so "omits the living" cannot pass by returning
nothing.

A private tree answers **404** to a caller who cannot read it — the same answer
as a tree that does not exist, because a 403 would confirm the slug.

## What it does not export

**Media.** An `OBJE` needs a path the receiving program can resolve, and there
is no honest answer for that in a download. Better to omit it than to write a
link that resolves to nothing on the other machine.

**Extension tags.** Anything without a standard tag becomes `EVEN` with a
`TYPE`, which is what `EVEN` is for. No `_MILI`, so no `SCHMA` block, so any
conformant reader takes the file.

## Round trips worth knowing

**Conflicting evidence survives.** Two censuses giving two birth years export
as two `BIRT` records with their own `SOUR`, `PAGE` and `QUAY`. GEDCOM allows
it and the Genealogical Proof Standard asks for it.

**The verbatim date travels.** The five columns reconstruct GEDCOM's grammar —
`ABT 1850`, `BET 1852 AND 1855`, `FROM 1900 TO 1940` — and `date_original`
follows as a `PHRASE` beneath it, so nothing is lost to the parse. A `phrase`
date emits an empty `DATE` with only the `PHRASE`, which is exactly what
GEDCOM 7 added it for.

**A disproven line is not exported.** It stays in the database as the record of
a mistake; writing it out would assert it.

## Build

```bash
pnpm build:extensions     # then restart Directus — dist/ is read at boot
```

Licensed under PolyForm Strict 1.0.0. See `LICENSE`.
