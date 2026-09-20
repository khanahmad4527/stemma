# Stemma

A multi-tenant genealogy backend on **Directus 12**, with a public website that
renders family trees.

The name is the Roman word for the thing itself: patrician families hung wax
ancestor masks in the atrium joined by painted lines showing descent, and the
display was the *stemma*. It survives in textual criticism, where a *stemma
codicum* is the family tree of manuscript copies.

**Status: the data model is built and proven, there is a site that renders it,
and the Data Studio is configured rather than left at its defaults.**
20 collections, 29 constraints / 52 triggers / 36 indexes, a **118-check suite**
that passes. Build steps 1, 2, 3, 5 and 6 are done; `apps/web` covers the
member-facing half of step 4 — Directus auth, four layouts (pedigree, fan, an
illustrated tree, descendants), three themes, portraits, the NSGC pedigree
symbols, search, a person panel, and a contrast check that fails the build.
The admin side is authored too: six nav folders, one measured colour, a
collapsed System group, 12 global bookmarks, and branding. Three extensions: the person
graph, the date parser and GEDCOM 7 export. What is not built: the
readable-error hook. The *anonymous* public site is a **non-goal** — see below. See **Build order** and `docs/data-model.md`. This file is
the brief — read it before proposing anything, because most of the shape below
is already decided and the reasoning is recorded so it does not get relitigated
every session.

---

## The one decision everything else follows from

**A family tree is not a tree. It is a directed acyclic graph.**

Cousins marry. Pedigree collapse puts the same ancestor in two positions of one
chart, and in endogamous communities that is the norm rather than an edge case.
Storage must not care, and the renderer must handle one person appearing several
times in the same diagram.

The corresponding schema mistake, which kills most hobby genealogy apps:

```
persons(id, name, mother_id, father_id)   ← never
```

That has no answer for adoption, step-parents, same-sex parents, donor
conception, surrogacy, foster placement, disputed parentage, or a child with two
biological and two adoptive parents on record. All of those are ordinary.

---

## Data model

Follows **GEDCOM X**'s shape, not classic GEDCOM's. GEDCOM (1985, now 7.0 —
FamilySearch, 2021) makes a `FAM` record the node and hangs people off it.
GEDCOM X replaced that with relationship edges, which handle every case above
without forcing a "family" to exist where there is not one.

```
trees            id, name, slug, is_public, owner
tree_members     tree, user, role(owner|editor|contributor|viewer)

persons          tree, sex_recorded, is_living, notes
person_names     person, type(birth|married|aka|religious|legal),
                 given, surname, prefix, suffix, nickname,
                 script_original, sort_order
couples          person_a, person_b
parentage        parent, child,
                 lineage(biological|adoptive|step|foster|guardian|donor)

events           subject_person | subject_couple, type,
                 date_* (see below), place, notes
places           name, parent_place, lat, lng
place_names      place, name, valid_from, valid_to

sources          repository, title, author, url
citations        source, page, assertion_target, confidence
media            file, caption, subject
```

Every collection carries `tree`.

The shape above is the brief's. **`docs/data-model.md` is the edge-case
register** — every case the schema must hold that it does not yet, the defects
found in what is built (one proven: the acyclicity trigger can be raced under
`READ COMMITTED`), and the decisions each needs. Read it before adding a
collection or a column; it also carries the per-collection checklist.

### Why these shapes

- **`couples`, not `marriages`.** Many unions were never marriages and produced
  children regardless. Marriage is an *event* on the couple, alongside divorce,
  and its absence is not a gap in the data.
- **`person_names` is a list.** Maiden and married names, the name at birth
  versus the anglicised one on the ship manifest, patronymics, surname-first
  ordering, spelling that drifts across thirty years of parish records. A single
  `name` column throws away the thing people search on.
- **Siblings are derived, never stored.** Two people sharing a parent are
  siblings; sharing both, full siblings. A stored sibling edge is a second
  source of truth that goes stale.
- **Events carry the facts.** Birth, death, baptism, burial, census,
  immigration, occupation, military service, religion. Columns on `persons` run
  out; an event table does not.

---

## Dates are ranges with qualifiers, not dates

The single thing that separates a real genealogy app from a toy. Get it wrong
on day one and every event row has to change later.

Genealogical dates look like: *about 1850*, *before 1900*, *between 1852 and
1855*, *1750/51* — dual dating across the Julian/Gregorian switch, when the
English year began on 25 March until 1752, so dates from 1 January to 24 March
were written with both years. Then Hebrew and French Republican calendars, and
Quaker numbered months. GEDCOM has a whole grammar for it: `ABT`, `BEF`, `AFT`,
`BET…AND`, `FROM…TO`, `EST`, `CAL`, `INT`.

So every date is five columns:

```
date_original    "abt 1850"     verbatim from the source, never parsed away
date_qualifier   about | before | after | between | estimated | calculated | exact
date_earliest    1845-01-01     the range it could occupy
date_latest      1855-12-31
date_calendar    gregorian | julian | hebrew | french_republican
```

Sort on `date_earliest`. Display `date_original`.

---

## Evidence, not conclusions

Two censuses give different birth years. The naive app overwrites; this one
keeps both assertions with their citations, and records which was concluded and
why.

That is the **Genealogical Proof Standard** (Board for Certification of
Genealogists): reasonably exhaustive research, complete and accurate citations,
analysis and correlation, resolution of conflicting evidence, a soundly reasoned
conclusion. **Evidence Explained** (Elizabeth Shown Mills) is the citation
standard to follow.

Practically: an event may carry several conflicting assertions, each with a
citation and a confidence, one marked as the conclusion. **Conflicting evidence
is a feature to display, not a bug to suppress.**

---

## Living people are a legal problem, not a display preference

Publishing a living person's full birth date and mother's maiden name hands over
two of the three standard identity-verification answers. It is also personal
data under GDPR, and a relative's consent is not their consent.

The convention: suppress anyone with no death record born within roughly the
last 100 years — show "Living" and nothing else.

`is_living` is a **stored, maintained boolean**, not a computed filter. The
public policy must stay a flat, indexable comparison.

---

## Two access paths, deliberately separate

Anonymous visitors have no membership, so do not route them through one.

**Public website** — two flat booleans and nothing else. This is the entire
public security model, and the test for it gets written before the feature:

```json
{ "_and": [ { "tree": { "is_public": { "_eq": true } } },
            { "is_living": { "_eq": false } } ] }
```

**Contributors** — membership-based, relational:

```json
{ "tree": { "members": { "user": { "_eq": "$CURRENT_USER" } } } }
```

Note this is many-to-many, unlike Enamel where a user belongs to one clinic. It
is a subquery per row rather than a column comparison, so index
`tree_members(user, tree)` from the start.

---

## Rules that belong in Postgres, not the application

Carried straight from Enamel: a rule enforced in application code holds for the
clients that go through that code; a rule enforced by the database holds for
every client there will ever be.

- **No person may be their own ancestor.** A `BEFORE INSERT OR UPDATE` trigger on
  `parentage` running a recursive CTE upward from the proposed child.
- **A person cannot be their own parent**, and `parentage(parent, child)` is
  unique per lineage type.
- **`couples` is unordered** — `(a, b)` and `(b, a)` are the same union. Enforce
  with a unique index on the sorted pair.

---

## Explicit non-goals

Write these in the README rather than leaving them as implied promises.

- **Cross-tree person matching.** If two users' trees both contain the same
  great-grandmother, those are two rows and Stemma does not know they are the
  same woman. The "one world tree" problem is what FamilySearch and Ancestry
  have spent decades and enormous sums on. Different product.
- **DNA matching.** Centimorgan segment analysis is its own discipline.
- **Record hints and search.** Requires a licensed records corpus, not code.
  That is Ancestry's moat.
- **GEDCOM import**, at first. Export is a weekend; import is months, because
  every vendor's GEDCOM is subtly non-conformant and you inherit their mistakes.
  Ship export; add import when there are users with existing trees.
- **Person merge** and **collaborative editing**. Until it is known to be the
  product.
- **An anonymous public website.** Decided 2026-09-20. Stemma renders trees for
  people who are signed in; there will be no logged-out front end.

  **The public *policy* stays, and is not dead code.** It is 19 permissions
  that prove the privacy boundary holds — an unauthenticated caller reads the
  dead of a public tree and cannot reach a living person by list, by id, by
  filter, through an edge, a name, a census she is a household member of, a
  citation that supports only her, or the street known only from her residence.
  That boundary is the load-bearing claim of the whole data model, `verify.ts`
  asserts both directions of it, and it is what any future consumer — an
  export, an embed, a partner API — would be gated by. Deleting it to match a
  cancelled front end would remove the proof, not the feature.

---

## Build order

1. ✅ `trees`, `tree_members`, `persons`, `person_names`, `parentage`, `couples`
   — plus the cycle trigger, `is_living`, and the public-policy test. Prove the
   graph holds and the privacy boundary works before anything renders.

   Both clauses done. The graph holds: `pnpm verify` sabotages a live instance
   and the database refuses a 4-generation loop, a 2-generation loop, a
   self-parent, a swapped couple and a cross-tree row — while still permitting
   pedigree collapse, which is the check that distinguishes a DAG from a naive
   "seen this ancestor already" guard, and permitting a step edge that closes a
   loop, because "I'm my own grandpa" is a family rather than an error. The
   privacy boundary is proven too, once the licence made the filters creatable:
   an anonymous visitor reads the dead of a public tree and cannot reach the
   living person by list, by id, by filter, through an edge, a name, a census
   she is a household member of, a citation that supports only her, or the
   street known only from her residence.

   One addition the brief did not call for: `persons.display_name`, maintained
   by a trigger from `person_names`. A cache, not a second source of truth —
   nothing may write it but the trigger and dropping it loses no information.
   Without it every list, m2o dropdown and chart label in the admin renders a
   raw uuid, because `display_template` cannot reduce an o2m.
2. ✅ `events` with the full date model, and the parser that fills it —
   `extensions/directus-extension-date-parser`. **Before** there is data,
   never after.
   Done: five-column dates with CHECKs on the qualifier's shape, a GiST index
   over `daterange(earliest, latest)`, `event_types` as a collection (53 global
   rows), `event_participants`, `associations`, one-conclusion-per-fact as a
   partial unique index, and the death → `is_living` trigger. The parser from
   `date_original` to the four derived columns is a **filter** hook, so the
   four land in the same INSERT as the original — one write, one revision, and
   the CHECK sees a finished row. `seed.ts`'s helpers were the specification:
   a bare `1889` becomes `about` spanning the year, not `exact`, because the
   CHECK reserves `exact` for a whole day. It refuses to guess — `12/03/1889`
   is March or December depending on which side of an ocean the clerk stood,
   so it answers `phrase` and keeps the original — and a hand correction in
   the same payload always wins.
3. ✅ The admin tree interface — `extensions/directus-extension-person-graph`.
   Parents, partners and children on the person form, with the pedigree
   symbols, navigating on click. An **alias** interface: it stores nothing,
   because everything it draws is already in `parentage` and `couples`. It
   reads through the injected `useApi()` so every request is filtered by the
   signed-in user's own permissions — a bare `fetch` would bypass that — and it
   guards `primaryKey === "+"`, which is an unsaved item and a 403 that looks
   like a permissions bug.

   Extensions load from `dist/`, which is gitignored, so `pnpm build:extensions`
   runs before `docker compose up` on a fresh clone and first in CI.
4. ✅ Public policy and the website read layer, as far as it now goes. The
   policy is done and proven (19 permissions; every row that can name a living
   person is filtered, and `verify.ts` asserts each direction). `apps/web` is
   the **member** half: React Router v7, SSR, the Directus token in an httpOnly
   cookie, four layouts, search, a person panel. The anonymous half is a
   **non-goal** as of 2026-09-20 — see **Explicit non-goals**. The policy it
   would have used stays, because it is what proves the boundary.
5. ✅ `sources` and `citations` — plus `repositories` and the M2A junction
   `citation_links`, whose `is_public_ok` a trigger maintains from the cited
   row's own visibility.
6. ✅ `places` with historical names (Danzig → Gdańsk), and
   `has_public_reference` so a street known only from a living person's
   residence never reaches the public filter.
7. ✅ GEDCOM 7 export — `extensions/directus-extension-gedcom`,
   `GET /gedcom/:slug`. The interesting half is that GEDCOM makes a **family**
   the node and this schema deliberately has no `FAM` row, so families are
   derived at export time exactly as the descendant chart derives them at
   render time. Lineage becomes `PEDI`, so an adopted child exports two `FAMC`
   links rather than losing one; three parents in one lineage — which this
   model allows and GEDCOM's one-`HUSB`-one-`WIFE` record does not — split
   across families rather than being dropped.

   It reads through `ItemsService` with the caller's own accountability, so
   the privacy boundary is the same 19 permissions and not a second copy of
   them. `verify.ts` proves the living person is in a member's export and
   absent from an anonymous one, gated on the anonymous export returning
   people at all.

### Rendering

Pedigree and descendant charts can use `d3-hierarchy` if duplicate nodes are
accepted for pedigree collapse — standard practice. A whole-graph view needs a
DAG layout: `elkjs` or `dagre`. Render **SVG, not canvas**: linkable, printable,
screen-readable. Genealogy users print.

---

## Conventions

**Schema is not code. It is pulled.** Directus 12.3 ships Environment Sync —
`d6s sync pull` writes an instance's collections, fields, relations, policies,
roles, flows, dashboards and translations to JSON under `directus/`, and
`d6s sync push` applies them to another instance. Those files are the source of
truth, they are **generated, and they are never hand-edited**.

This reverses what this file said until 2026-09-18, which was Enamel's rule —
"schema is code, applied idempotently", with a hand-written `apply.ts`
reconciling declarative TypeScript. That was right when Enamel was built and is
now rebuilding something the platform ships, and rebuilding it worse: the CLI
resolves record identity across environments through an `id_map.json`, refuses
to guess in CI, and gates deletions behind `--dangerously-allow-delete`.
Directus is explicit that the model is UI-first — *"code isn't the source of
truth"*, model in the Data Studio and pull. Stemma follows the tool rather than
fighting it.

Do not relitigate this by observing that the reasoning no longer lives beside
the fields. It does: notes and labels are `$t:` keys resolved from
`directus_translations`, which **is** carried by the sync, so the argument for
`couples` over `marriages` travels to every environment. What will not fit in a
field note goes in `docs/`.

**What the sync does not carry, and therefore what `bootstrap/` is for.** This
list is the whole justification for the package existing, so check against it
before adding anything there:

- **Database DDL — all of it.** CHECK constraints, unique indexes over an
  expression, triggers, extensions. `constraints.ts`. The acyclicity trigger,
  the sorted-pair index and the tree-agreement trigger are the four guarantees
  this schema actually makes, and none of them would exist on a freshly pushed
  instance.
- **`directus_presets`** — deliberately excluded upstream, because bookmarks mix
  shared configuration with personal preference. That is right for "Katarzyna
  sorted persons by surname last Tuesday" and wrong for the two kinds of preset
  that *are* configuration, so `presets.ts` hand-writes both: a designed default
  list view per collection, and **12 global bookmarks** — each one a question
  the data model exists to answer and a new contributor would not know to ask.
- **`directus_files`** — no uploads, and therefore no branding either. The
  settings row travels and the two images it points at do not, so a pushed
  environment arrives with a logo id it has never seen. `brand.ts` is the other
  half, and it is a separate step for that reason.
- **Records in your own collections** — `seed.ts`.
- **Proof** — `verify.ts`. Sync moves configuration; it never asserts the
  configuration is right.

**`author.ts` is scaffolding, not a source of truth.** Something had to put the
schema into the first instance before there was anything to pull, and an agent
cannot click. It ran once; `directus/` is authoritative now. Change the schema
in the Data Studio and pull.

**Reuse Enamel where it still applies.**
`~/Desktop/Ahmad/khanahmad4527/enamel/apps/directus/bootstrap/src/` (note the
path — not `enamel/bootstrap/`) is the reference for `client.ts`'s 429 handling,
`constraints.ts`'s pre-flight-and-refuse pattern, and `verify.ts`'s shape. Its
`apply.ts`, `schema/*.ts` and i18n apply layer are superseded by the CLI.

Inherited from that project, and still worth keeping:

- **Rules that must always hold live in Postgres.** A rule enforced in
  application code holds for the clients that go through that code; a rule
  enforced by the database holds for every client there will ever be. The
  readable error lives in a Directus hook extension that runs first — two
  layers, because the hook races and the constraint cannot. *(The hook is not
  built yet; the DDL messages are written to be readable on their own until it
  is.)*
- **`verify.ts` asserts both directions**: what each role must reach and what it
  must not. **Every check is proven falsifiable by sabotaging the instance**,
  because a suite that cannot fail is decoration. Stemma adds one rule to this:
  **a check that could not run is reported as a failure, never as a pass.** The
  trap is specific — "an anonymous visitor cannot see the living person" passes
  trivially when the public policy grants nothing at all, so the negative checks
  are gated on a positive one demonstrating the public read works.
- Field notes, collection notes and choice labels go through `$t:` keys so all
  languages stay in step.
- Every collection gets a designed default list view. Without one, Directus
  picks whichever columns it finds first.

**A licence key is required, not optional — and is in place.** At core tier
Directus 12 answers any permission carrying a filter with
`custom_permission_rules_enabled is a restricted resource`, and caps the
instance at 3 seats and 25 collections. This instance runs at the Open
Innovation Grant tier (`GET /license` → `status: active`); all 103 permissions
applied. If a fresh environment refuses the access model, check the tier before
debugging `access.ts`.

**Directus cannot authorise a create. Postgres does.** Its `permissions` filter
is ignored on create (no row yet) and its `validation` is a flat check on the
payload — a relational rule like `tree.members.user = $CURRENT_USER` answers 400
for contributor and stranger alike, and `_nnull` on an absent field does not
fire at all (use `_submitted`). So the policy grants create and
`stemma_writer_is_member` reads `user_created` against `tree_members` before
the row lands, with admins exempt. Found by the check suite, not by reading.

**Triggers that check before they write take a per-tree advisory lock**, and
**triggers that write to their own table are column-specific** (`UPDATE OF …`).
Both rules exist because their absence was demonstrated: the acyclicity check
was raced into accepting a cycle, and the events visibility trigger recursed
until the stack ran out. See the header of `constraints.ts`.

**Charts read top to bottom, oldest first** — pedigree included, which is
conventionally printed sideways. Generations stack the way people picture a
family tree and a deep line scrolls rather than running off the page.

**A descendant chart lays out couples, not people.** Otherwise the person who
married in never appears. Union bars join partners, children hang off the union
they belong to (a man with two wives has two sets of children, not one brood),
a doubled bar marks a union between kin, and a family is drawn once — the second
occurrence of a couple is marked rather than repeating the branch. Families are
**derived at render time** from `couples` and `parentage`: GEDCOM stores a `FAM`
node and this schema deliberately does not, but a drawing needs one, the same
way siblings are derived and never stored.

**Facts are carried by shape, never by colour alone.** Sex is a square, a circle
or a diamond; death is a diagonal stroke; adoption is a pair of brackets and a
dashed line of descent. That is the NSGC standardized pedigree nomenclature
(Bennett et al., 2022), not an invention — so it reads without a legend, survives
a photocopier, and avoids pink/blue, which is both a stereotype and invisible to
the commonest colour-blindness. `sex_recorded` is what a document recorded, never
identity. Colour is then free for something cheerful: branch-of-descent in the
Tree layout, generation in the Fan.

**Colour is computed.** Generations are *ordinal* — one hue, monotone lightness,
never a rainbow. Categorical branch tints cap at **three**: four hues fail the
normal-vision separation floor (yellow↔orange ΔE 13.7 against a floor of 15), so
a fourth line goes neutral rather than get an invented colour. Run the palette
validator before changing a hue, and `pnpm contrast` after.

**Contrast is measured, not eyeballed.** The first palette failed WCAG AA in 45
places, and the worst offenders were the dates — which is most of what this
interface shows. `pnpm contrast` drives a browser, resolves the colour actually
painted (SVG `fill` included, and `color-mix`, which Chrome serialises as
`oklab()` — a naive parser reads that as an rgb triple and invents failures),
and fails below 4.5:1 body / 3:1 large. It is proven falsifiable the same way
`verify.ts` is: revert one token and three sections go red. Three themes —
Garden, Dusk, Tapestry — and a new colour has to clear the check in all of them,
in all four layouts. The demo seeds three trees on purpose: `kowalski` (small and
interesting), `ashcombe` (ten generations — depth is where layout bugs live), and
`vance` (every edge case at once). Check a rendering change against all three.

**Every version is exact. No carets, no tildes, anywhere.** All 33 dependency
specifiers across the four packages are a single version; `.npmrc` sets
`save-exact=true` so `pnpm add` cannot quietly reintroduce a range, and
`prefer-frozen-lockfile=true` so an install never silently resolves something
the lockfile does not already describe.

It is not only `package.json`. Docker images carry a tag **and** a digest —
`16-alpine` is a moving target that becomes a different Postgres on any pull.
GitHub Actions are pinned to a **commit**, not a tag: a tag is mutable, and
whoever controls the action's repository can move `v4` to any commit they like
and have it run with this workflow's permissions. The trailing comment records
which release the commit was.

Two things look like versions and are deliberately left as ranges:

- `directus:extension.host: "^11.0.0 || ^12.0.0"` — a **compatibility
  declaration**, not a dependency. It states which Directus versions the
  extension supports. Pinning it to one version would make the extension refuse
  to load on every other.
- `engines.node: ">=18.17"` — a minimum, not a dependency.

**No dead code, and it is enforced.** Both `tsconfig.json`s set
`noUnusedLocals` and `noUnusedParameters`, so an unused import, local or
parameter fails `pnpm typecheck` rather than waiting to be noticed. Proven to
bite: add a stray `const` and the typecheck goes red.

That covers locals. The categories it cannot see, and how they were found once
(worth repeating before a big refactor rather than trusting a hunch):

- **Files no entry point reaches** — walk imports from every `package.json`
  script and every framework route. Found none in `bootstrap/`; in `apps/web`
  only the two config files, which tooling loads rather than imports.
- **Exports nothing imports** — grep each `export const|function|type` for a
  use elsewhere. Careful: React Router's `loader`, `action`, `meta`, `links`,
  `Layout` and `ErrorBoundary` are called by convention and look orphaned.
- **Branches nothing reaches.** `layoutBoxes` took a `"up" | "down"` direction
  and only `"up"` was ever passed once the descendant chart grew its own
  family-aware builder; it is `layoutPedigree` now.
- **Orphan `$t:` strings** — a key in `directus_translations` that no field
  note references. The `biological → birth` rename left one behind.

**The README is checked like any other claim.** `verify.ts` asserts its figures
— collection count, the size of the suite itself, constraint and trigger counts,
how many themes and layouts — against the running instance. A number in a README
rots the moment somebody adds a collection, and a project arguing that a check
which cannot fail is decoration cannot then leave its own front page unchecked.
Proven falsifiable: change 20 to 19 and the run goes red.

**The Data Studio is a deliverable, not a debug console.** It is the interface
an editor actually works in, and it was left at its defaults for a while: twenty
collections in one flat sidebar, colours assigned per collection with no scheme,
`id` and the audit columns hidden rather than grouped, no bookmarks, no logo and
a project called "Directus". All of that is now authored — **six nav folders**,
a collapsed **System** group holding `id` and the four audit columns, a
`display` on everything that can reach a list, 12 global bookmarks, and
branding. `verify.ts` has a section for it, because none of this fails loudly
on its own.

**One colour, and the grouping does the rest.** The first attempt gave each of
the six domains its own hue, searched so the set cleared a separation floor —
min OKLab ΔE 15.6, every hue ≥3:1 on all four chrome backgrounds. Both gates
passed and the result was still wrong: a sidebar of violet, green, crimson,
blue, ochre and teal is a paintbox, and hue was doing work the folder grouping
and the per-collection icon already do better. Twenty collections do not get
easier to scan by being six colours; they get easier to scan by being six
*groups*. So everything — collection, folder, bookmark — takes the one colour,
and **a folder collection always gets the `folder` icon**, because a folder is
chrome and should not compete with the collections nested inside it.

**Bookmarks are a different kind of row, and the colour says only that.**
Twelve saved views sit nested under the twenty collections they open, so the
question the eye asks in that sidebar is "collection or saved view?" — not
"which of the twelve?", which the label right beside it already answers. So all
twelve share one icon (`bookmark`) *and* one colour, gold `#BB7E00`, which is
ΔE 30.4 from the collections' blue — twice the floor, and warm against cool
reads before you focus.

An earlier version gave each bookmark its own hue. It could not clear the floor
with twelve categories anyway (min ΔE 6.3), and it put a rainbow back into a
sidebar that had just had one taken out.

**The label needed `custom_css`, and that is the sanctioned hook, not a hack.**
A preset's `color` reaches its icon only, and Directus's theme rules colour the
nav as a whole — `navigation.list.foreground` hits collections too. There is no
theme rule for "a saved view's text", and no extension can supply one, because
the nav is not an extension's to render. `directus_settings.custom_css` is the
documented escape hatch, and `.bookmark` is a real class Directus puts on the
anchor (`a.v-list-item.link` for a collection, `a.v-list-item.link.clickable.
bookmark` for a bookmark). Two rules, because no single colour is 4.5:1 text on
both a near-white and a near-black shell — the luminance windows do not overlap
— and Directus marks the resolved appearance on the body (`body.light` /
`body.dark`) even when the setting is `auto`. Measured in a real browser against
the background actually painted: **5.49:1 light, 8.19:1 dark**.

**There is no DOM hook for a global bookmark versus a personal one**, so the CSS
keys off the data instead. A preset saved by a contributor for themselves and one
saved for everybody render byte-for-byte alike — same classes, same attributes,
the only difference being the `?bookmark=<id>` in the href, and ids differ per
environment. That was established by creating a personal bookmark and diffing the
two anchors, not assumed. What *is* in the DOM is the preset's own colour, which
Directus writes onto the icon as an inline custom property, so the selector is
`.v-list-item.bookmark:has(.v-icon[style*="#BB7E00"])` — the label follows the
icon it belongs to, every global bookmark carries that exact value because
`presets.ts` sets it, and a contributor's private view keeps the default
foreground. Where `:has()` is unsupported the rule simply does not match, which
is the right way to fail: no colour rather than the wrong one. `verify.ts`
asserts the `:has()` is still there, because a rule that lost it would silently
restyle everybody's private bookmarks.

The colour is `#2A78D6`, which is `--accent` from `apps/web/app/app.css`, so
the admin and the site read as one product. `pnpm theme` measures every value
the admin paints against the surface it is painted on, and it still bites:
`#1F66BE`, the obvious single colour, fails the icon gate at 2.69:1 on the dark
raised surface, which is why the icon is `#2A78D6` and only the light theme's
`primary` steps down to `#1F66BE` — Directus paints `primary` as link *text* as
well as a button fill, so it needs 4.5:1 in both directions. The web app made
the same split (`--accent` for fills, `--accent-text` for text) for the same
reason. What the check no longer asserts is a ΔE floor: a separation floor over
a one-element set is a check that cannot fail, which this project calls
decoration.

**One brace in one field note took out every label in the Data Studio.** This is
the trap worth remembering. Directus merges `directus_translations` into vue-i18n
escaping only `@ $ |`, so `{` and `}` stay live and each value is compiled as a
message with placeholders. A note read `A list of {type, value}` — not a valid
placeholder — so the compile threw, and the throw landed inside `loadLanguage`'s
bare `catch {}`. `translateFields()` therefore never ran: **all 287 `$t:` keys in
the instance rendered raw**, and `person_names`, the one collection carrying that
note, rendered an **entirely empty form**, because the same SyntaxError surfaced
again during render and took the subtree with it. Nothing 500'd, nothing was
logged, and the suite was green throughout. Two layers now, as usual:
`applyStrings()` refuses to write a braced value, and `verify.ts` asserts none is
stored. Both proven falsifiable.

**A declaration is authoritative, so `applyField` resets what it owns.** A PATCH
to `/fields` merges — keys you send are written, keys you omit keep whatever they
were — which makes *adding* a property idempotent and *removing* one silently
impossible. Taking `hidden: true` off `timestamps()` reached a fresh instance and
left every existing one with the audit columns still hidden, inside the new group,
so the group opened onto nothing. `OWNED_META` now names the keys the authoring
layer controls and sends their off-value when the declaration omits them.
`special` is deliberately not on that list.

**And the array owns the field order.** `sort` was excluded from `OWNED_META`
at first because Directus assigns it at creation — which it does, in the order
fields were *added over time*, not the order they are declared in. The two
drifted: `persons` declares the custom graph interface immediately under its
"Graph" divider and the instance had it at sort 28, below the portrait, with
the divider introducing two plain o2m lists instead. The array in `authoring/`
is the designed reading order of the form, so it sets `sort` from its own
index. An explicit `meta.sort` still wins, which is how the collapsed system
group pins itself to 90 and stays last however many fields appear above it. The same rule bit
`brand.ts`: uploading-once-by-title meant an edited SVG could never reach an
instance that already had the old bytes, and the file cannot be deleted because
`directus_settings` has a foreign key onto it — so it compares the bytes and
PATCHes them in place.

**Never put a backtick in SQL inside a template literal.** `constraints.ts` is
one long TypeScript template string; a backtick in a `--` comment ends the
string mid-statement and the error surfaces as a JavaScript parse failure
hundreds of lines away. Typecheck before running `pnpm rules`.

**Colour lives only in the `:root` blocks.** Everything below them uses tokens,
which is what made a third theme a palette rather than a rewrite. If you find
yourself typing a hex outside a theme block, add a token instead.

**Measure the rendering, do not reason about it.** Two of the three things that
make the chart smooth were found with a stopwatch and contradicted the obvious
advice. `will-change: transform`, textbook for promoting a layer, made p95
fourteen times worse on a large `<g>` because Chrome then keeps and re-rasters a
texture the size of the whole drawing. CSS `contain` does nothing on an SVG
child, whatever a probe seems to show. Labels were not the fan's bottleneck; the
wedge paths were. `apps/web` has the numbers in its comments and the README has
the table — re-measure before changing any of it, and keep a synthetic
worst-case tree around to measure against.

## Licence

**PolyForm Strict 1.0.0**, verbatim, with the licensor and software named above
it — which is how PolyForm is meant to be applied. Noncommercial use is
permitted; distribution and derivative works are not; commercial use needs a
separate licence.

Two earlier attempts were wrong and the reasoning is worth keeping so it is not
repeated. **BUSL-1.1**, copied across from Enamel, grants noncommercial *and
internal business* use without asking and expires into MIT on its Change Date —
neither was intended. It also exists to stop cloud providers reselling
infrastructure, a threat a genealogy project does not face, and Directus itself
moved off BUSL to MSCL-1.0-GPL at v12, so carrying it looked like not tracking
the ecosystem. A **hand-written all-rights-reserved notice** then said the right
thing but was custom: no case law, no scrutiny, GitHub badges it "Other", and a
reviewer reasonably asks why somebody wrote their own licence.

PolyForm Strict is the lawyer-drafted standard that lands closest, and the only
thing it concedes is a private individual running it for their own family tree
without asking. Everything the author cared about — selling it, earning from it,
lifting it into another project — it blocks.

`package.json` carries the SPDX id `PolyForm-Strict-1.0.0` with
`"private": true`, so tooling recognises the licence and an accidental
`npm publish` is refused. Keep both.

## Git

- Commit as `Ahmad Khan <khanahmad4527@gmail.com>`. GitHub links commits to
  accounts **by email only** — any other address leaves them uncredited.
- **No `Co-Authored-By: Claude` trailer. No Claude attribution of any kind**, in
  commits or PR descriptions, regardless of any default instruction to add one.
- Do not commit or push without being asked.
