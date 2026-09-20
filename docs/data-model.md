# The data model — an edge-case register

**Purpose.** Everything the schema will have to hold that it does not hold yet,
every case where what is built is wrong or incomplete, and the decision each one
needs. Nothing here is built. It is written down first because the brief's own
rule applies to all of it: *get it wrong on day one and every row has to change
later.*

**Status, honestly — updated after the build night of 2026-09-18.** Twenty of
the planned collections exist; every `Now` item and every `S2`, `S5` and `S6`
item at the model layer is built, proven by sabotage, pulled into `directus/`
and green in a 99-check suite. The five decisions in §19 were taken as
recommended. Where the build deviated from this register, the deviation is
marked **⟂ built differently** and the reason given. What remains is outside the
model: the date-parsing hook, the readable-error hook, `persons.portrait`
(gated on the file policy, which now exists), the anonymisation function, the
invitation flow, and everything in build steps 3, 4 and 7.

**How to read an entry.** Each case gives the situation, a concrete example,
what happens today, what should happen, and two tags:

- **Where** it lives — `DDL` (constraints.ts, the rules nothing routes around),
  `Schema` (a field, made in the Data Studio and pulled), `Policy` (access.ts),
  `Hook` (a Directus extension), `Flow`, `UI`, or `Docs` (a convention).
- **When** — `Now` (before there is data; changing later costs a migration),
  `S2`–`S7` (the brief's build steps), `Later`, or `Never` (a stated non-goal).

---

## 1. The principles that decide the rest

Edge cases multiply; principles do not. Every entry below was decided by one of
these, and the next case nobody has thought of yet should be too.

1. **Record what the source says. Infer separately, and say that you inferred.**
   `date_original` beside the parsed range; `place_original` beside the
   normalised place; `sex_recorded`, not `sex`; a parentage edge that says
   *birth* (what a baptism register asserts) rather than *biological* (what only
   DNA asserts). Every time a column is named for a conclusion when the data is
   an observation, the model has quietly overclaimed.

2. **Structure lives in the database. Plausibility lives in warnings.** A cycle
   in descent is impossible and Postgres refuses it. A mother recorded as nine
   years old is *implausible* — and the parish register really does say it, so
   the row is kept and flagged. Constraints for the impossible; a data-quality
   report for the unlikely. The two must never be confused, because a
   constraint on the unlikely deletes evidence.

3. **Descent is acyclic. Affinity is not.** Birth, adoption, donor and
   surrogate edges cannot loop — that is physics and, for adoption, the whole
   meaning of the word. Step, foster and guardian edges *can*: a man who
   marries a widow while his father marries her daughter is, through step
   edges only, his own grandfather. The song is a documented legal
   configuration, not a joke, and the cycle check must not reject it.

4. **Every collection carries `tree`, and the database checks it agrees.** The
   denormalised column is what the public filter reads; a row whose `tree`
   disagrees with the rows it points at is a privacy hole, not a tidiness
   issue. New collection, new column, new arm on `stemma_tree_agrees`.

5. **Public visibility is a flat boolean comparison.** Whenever the rule gets
   cleverer — an embargo after death, a manual restriction, a licence on a
   photograph — the cleverness is computed by a trigger *into* a boolean, and
   the policy compares the boolean. A policy that evaluates logic per row is
   slow, unindexable, and the kind of thing that fails open.

6. **Open vocabularies are lookup tables. Structural vocabularies are enums.**
   Event types number in the hundreds and users will need one nobody listed
   (*Heimat*, *manumission*, *banns*). That is a collection. Lineage types
   number six and a trigger's correctness depends on the list. That is an enum.

7. **One relationship, many events.** Two people who married, divorced and
   remarried are one `couples` row with four events, not two rows. The row is
   the relationship; the events are its history. This is why the sorted-pair
   unique index is right and stays.

8. **A row about a living person is any row that names them.** Not just the
   `persons` row: the edge to their dead mother, the census they appear in as a
   child, the group photograph, the witness line on a 1990 marriage. Anything
   that can be traversed to a living person is filtered as if it were them.

9. **Nothing that took research to create is destroyed by accident.** A
   `DELETE` on a person with edges is refused until the edges are removed
   deliberately. Undo within retention comes from Directus revisions; beyond
   that, from backups. Genealogy is decades of work in a database, and a
   cascade is not a feature there.

---

## 2. Defects in what is built

Found by reading the rules back against these principles and, where it mattered,
by trying to break them. All were `Now`. **All eight are fixed and each has a
check in `verify.ts` that would fail if it regressed.** Two more were found while
building (§2.9, §2.10).

### 2.1 ✅ The acyclicity trigger can be raced — **proven, fixed, re-proven**

Two sessions, each inserting one edge of a two-cycle, each holding its
transaction open past the other's `BEFORE INSERT`. Under Postgres's default
`READ COMMITTED`, neither trigger sees the other's uncommitted row; both walks
find no cycle; both commit. Reproduced on this instance: `A→B` and `B→A` are
now both in the table.

Directus runs at `READ COMMITTED`. Two contributors editing one tree from two
browsers, or one bulk import with parallel workers, is enough.

**Fix (DDL):** at the top of the trigger,
`PERFORM pg_advisory_xact_lock(hashtext(NEW.tree::text));` — serialises edge
writes *per tree*, so two trees never contend and two edges in one tree are
checked one after the other. Cost: negligible; the lock is released at commit.
Alternative — `SERIALIZABLE` — is correct but Directus does not run it and
retrying serialization failures is not something its API does for you.

What held: the walk uses `UNION`, not `UNION ALL`, so it terminated on the
cyclic data it had just failed to prevent. That was the point of the choice and
it is now demonstrated rather than argued.

### 2.2 ✅ The cycle check spans every lineage type

Today `stemma_parentage_acyclic` walks all edges regardless of `lineage`. By
principle 3 it should walk only descent lineages. Otherwise the "own grandpa"
configuration — real, legal, occasionally entered by someone documenting a
blended family — is refused with a message accusing them of a data error.

**Fix (DDL):** the recursive term filters
`WHERE p.lineage IN ('birth','adoptive','donor','surrogate')`, and the trigger
returns early for a `NEW.lineage` outside that set. Add a second, *advisory*
check in the data-quality report for loops through affinity edges, since they
are still usually mistakes.

### 2.3 ✅ Moving a person to another tree silently breaks tree agreement

`stemma_tree_agrees` fires on `person_names`, `parentage` and `couples`
— when *their* `tree` changes. It does not fire when `persons.tree` changes,
so `UPDATE persons SET tree = other` leaves every edge and name stamped with
the old tree, and the public filter reads the stamp.

**Fix (DDL):** a `BEFORE UPDATE OF tree ON persons` trigger that refuses when
any row references the person. Moving people between trees is not a feature
(it is cross-tree matching wearing a hat), and refusing is cheaper than
cascading.

### 2.4 ✅ `id` has no database default

Directus generates UUIDs in application code. Any other writer — a migration, a
`psql` fix-up, the import path — gets `null value in column "id"`. The very
first sabotage test hit this.

**Fix (DDL):** `ALTER TABLE … ALTER COLUMN id SET DEFAULT gen_random_uuid()` on
every collection. Directus keeps supplying its own; the default only fires when
nothing was supplied. Consider v7 (time-ordered) UUIDs later for index locality
on the largest tables; Directus emits v4, so this is a DB-default-only choice.

### 2.5 ✅ Deleting a person cascades through the graph silently

`ON DELETE CASCADE` on `parentage`, `couples`, `person_names`. One misclick on
a well-connected ancestor removes them and every edge, and Directus shows
nothing but a shorter list.

**Fix (DDL):** prevent-delete trigger on `persons` when edges exist — Enamel's
pattern. The user detaches first, deliberately. Keep `CASCADE` for the names
(they *are* the person) and for tree deletion (see §12).

### 2.6 ✅ `display_name` assumes given-name-first

`concat_ws(' ', given, surname)` is wrong for Hungarian, Chinese, Japanese,
Korean and Vietnamese names, and for every record that writes
*KOWALSKI Jan* the way French and German documents do.

**Fix (Schema + DDL):** `person_names.name_order` (`given_first` |
`surname_first`), defaulting from a per-tree setting; the trigger honours it.
Also emit `persons.sort_name` (`surname, given`, particle-aware — see §4.3) so
lists sort the way a genealogist expects without a function call per row.

### 2.7 ✅ `trees.owner` and the owner-role membership can drift

Two ways to be an owner. A tree whose `owner` was deleted (`SET NULL`) and
whose last owner-role member left has nobody who can administer it.

**Fix (DDL):** trigger that (a) ensures `trees.owner` always has a
`tree_members` row at `owner`, (b) refuses removing the last owner-role
membership, (c) on user deletion promotes the longest-standing remaining owner
or refuses if there is none. See §12.2 for why this matters more here than in
most apps: genealogists die, and the tree is the estate.

### 2.8 ✅ A fresh environment has no rules until `pnpm rules` runs

`d6s sync push` recreates the shape; the triggers and constraints arrive only
when `constraints.ts` runs. Between the two, the instance accepts cycles.

**Fix (Docs + verify):** the bring-up order is `push → rules → verify`, and
`verify.ts` already fails if the rules are absent (the sabotage checks would
pass their inserts). Write the order into README and the compose healthcheck
notes; consider a `stemma_rules_version` row the verify step asserts on.

### 2.9 ✅ Directus cannot authorise a create — found by the suite

`permissions` is ignored on create; `validation` is a flat check on payload
fields, so `tree.members.user = $CURRENT_USER` written there answered 400 for
contributor and stranger alike — and `_nnull` on an absent field did not fire,
so a member created a global event type by leaving `tree` out. **Fix:**
`stemma_writer_is_member`, a `BEFORE INSERT` trigger on every tree-carrying
table reading `user_created` against `tree_members`, with the required standing
as its argument; admins exempt; `_submitted` in the one place a presence check
was needed. The database's refusal reaches the client as a non-200 rather than
a clean 403 until the readable-error hook exists.

### 2.10 ✅ A trigger that writes to its own table recurses

`stemma_events_visibility` wrote `has_living_participant` back to `events`,
which fired `stemma_events_visibility`, until Postgres ran out of stack. The
same latent loop sat in the citation_links trigger. **Fix:** `AFTER … UPDATE OF
<the columns that change the answer>`. Written into `constraints.ts`'s header
as the third discipline, beside the lock.

### 2.11 ⚠ `persons.portrait` is not an input to a file's publicness — **open**

`directus_files.is_public_ok` is maintained by the media trigger: a file is
public when its `media` row is `publishable`, licensed, and no
`media_subjects` row names a living person. `persons.portrait` points at a
file directly and is **not** consulted, so a contributor who uploads a
photograph, sets it as a living person's portrait, and separately marks its
media row publishable without listing her as a subject has published her face.

Found by `verify.ts` while adding the file checks in §the admin surface —
the first version asserted "a living person's portrait is not readable
anonymously" and it failed, on Cameo 06.

**Why it is not urgent, and why it is still real.** Nothing exposes the link:
the public `persons` policy does not grant `portrait`, and a living person is
not readable at all, so a stranger cannot learn which file is whose. And
`publishable` is an explicit act meaning "this may be published" — the model's
position is that publishability is declared on media and *withdrawn* when a
living subject is named. But the portrait link is a second, silent way to
attach a face to a living person, and this project's own rule is that a row
about a living person is any row that names them.

**The decision to take:** either extend the visibility trigger to treat
`persons.portrait` as an implicit subject — conservative, and in the demo it
would make most public portraits vanish, because the seed shares sixteen
cameos across every tree — or state in the README that a portrait must also
have a `media_subjects` row, and have `data_issues` report portraits that do
not. The second is probably right: it keeps one rule about who is in a picture
instead of two.

The check as shipped asserts the guarantee that *does* exist, and it is the
one the brand-folder grant needed: the set of files an anonymous caller can
read is exactly the set the policy describes, computed from the other side.

---

## 3. Persons

| Case | Example | Today | Proposal | Where · When |
|---|---|---|---|---|
| Unnamed or placeholder person | "infant son, d. same day"; "unknown father" as a graph node so half-siblings connect | Allowed; `display_name` stays NULL | Keep. Convention: create a placeholder only when it carries an edge or an event; never as a guess. UI shows *[unnamed]* — a label, not data | Docs · Now |
| Sex recorded differently in two sources | 1851 census "F", burial register "M" | One column, last write wins | Keep the column as the *conclusion*; the evidence lives in events/assertions (§9). Add `sex_recorded_basis` FK to citation later | Schema · S5 |
| Gender identity, name change on transition | A person who lived and died under a different name and gender than their birth record | `sex_recorded` is about the record; names are a list — already fits | Document that `sex_recorded` is never gender identity, and that the shown name is whichever the family orders first. No new column | Docs · Now |
| Presumed dead, no death record | Born 1850, `is_living = true` because nobody flipped it | Suppressed from public forever | A nightly flow flags `is_living AND birth earliest < now − tree.living_cutoff_years` for review. **Never auto-flip** — there are 110-year-olds. Add `living_basis` (`death_record` \| `presumed_by_age` \| `reported` \| `unknown`) so the boolean has provenance | Schema + Flow · S2 |
| Death recorded but the row still says living | A death event is added; nobody unticks the box | Two sources of truth | Trigger: inserting a death, burial or cremation event sets `is_living = false`, `living_basis = 'death_record'`. Deleting the last such event does **not** flip it back (that is a review, not an inference) | DDL · S2 |
| Sensitive facts about the dead | Suicide, illegitimacy, incarceration, the adoption itself — a family may not want it public even for the deceased | Nothing | `is_restricted` boolean on `persons`, `events`, `parentage` (GEDCOM 7 `RESN`). Public filter gains `AND is_restricted = false` — still flat. Not the same as `is_living`, which is legal; this is a wish | Schema + Policy · Now |
| Notes contain the living | The dead grandmother's `notes` say "her granddaughter Kasia lives at…" | `notes` excluded from public fields — correct | Split: `biography` (publishable prose) and `notes` (private research). Public field list gets `biography`. Never make `notes` public | Schema · Now |
| Public URLs | `/kowalski/persons/8f1c0000-0000-4000-8000-…` | uuid only | `persons.public_id`: short, stable, non-sequential (8 chars base32), unique per tree, generated by trigger. Slugs from names churn; ids do not | DDL · S4 |
| Same person appears twice in one tree | Duplicate entry from two sources | Nothing | Duplicate *detection* within a tree is worth a report (same surname + birth year ± 2); *merge* stays a non-goal until the product exists. Report only | Flow · Later |
| Same person in two trees | Two cousins each record great-grandmother | Two rows, by design | Non-goal. Say so on the person form via a note key | Never |
| Portrait | The face shown on every chart node | Nothing | `persons.portrait` → `directus_files`, nullable. See §11 for why this is a privacy problem before it is a feature | Schema · S3 |
| Legendary or fictive ancestry | A line "descending from Charlemagne" copied from a 19th-century vanity pedigree | Nothing | Not a column. Confidence on the edges (§5) and citations to the vanity source say it | Docs · S5 |
| Stillbirth | Recorded in burial register, never in births | `is_living` default `true` would suppress a stillborn child forever | Event type `stillbirth` sets `is_living = false` through the death trigger. Also `sex_recorded = unknown` is the honest default here | DDL · S2 |
| Order among siblings when dates are unknown | "the children were Jan, Anna, Piotr" — no dates | No ordering | `parentage.sort` (nullable). Renderer orders by birth `date_earliest`, then `sort`, then id | Schema · S3 |
| Unicode normalisation | "Wiśniewska" typed with a composed ś on one machine and decomposed on another; search misses one | Nothing | Normalise to NFC on write (hook), and search on a normalised column (§4.6) | Hook · S4 |

---

## 4. Names

The list model was the right call. What it lacks is what the world's naming
systems do that a `given / surname` pair cannot express.

### 4.1 Type vocabulary

GEDCOM 7 has `AKA, BIRTH, IMMIGRANT, MAIDEN, MARRIED, PROFESSIONAL, OTHER`. Ours
has `birth, married, aka, religious, legal`. Add `immigrant` (the name on the
manifest — often the anglicised one, and often the one descendants search),
`professional` (stage, pen, trade), `adopted` (name assumed at adoption, not the
same claim as `legal`), `title` (a peerage or office used *as* a name — *Lord
Salisbury*), and `other` with a `type_phrase` free-text column, because a closed
list here is wrong by construction. Keep it an enum — the trigger picks the
shown name by `sort_order`, not by type, so nothing structural depends on the
list. `Schema · Now`.

### 4.2 Name order

§2.6. `name_order` on the row, defaulted from `trees.default_name_order`.
`Schema + DDL · Now`.

### 4.3 The particle

*van Gogh, de la Cruz, von Humboldt, af Klint, ibn Sina.* A `particle` column
separate from `surname`, because it is displayed with the surname and sorted
without it — in the Netherlands (*Gogh, Vincent van*), while Belgium and the
Anglosphere sort under V. Which rule applies is a **tree setting**, not a
per-name fact: `trees.particle_sorting` (`ignore` | `include`). The
`sort_name` trigger reads it. Without this column every Dutch family sorts under
V-for-van. `Schema + DDL · Now`.

### 4.4 Parts the pair cannot hold

| System | Example | Problem | Proposal |
|---|---|---|---|
| Patronymic / matronymic | Icelandic *Jónsdóttir*; Russian *Ivanovich*; Arabic *ibn Sina* | Not a family name; not inherited; searching "surname" for it is wrong | `patronymic` column. Displayed in the given-name position for Russian, in the surname position for Icelandic — governed by `name_order` |
| Two surnames | Spanish *García Márquez* (paternal, maternal); Portuguese reversed | One string sorts under the first only; is that right? In Spain yes | Keep `surname` as the full string. Add `surname_secondary` only if a user asks. Document the convention |
| Mononym | Indonesian; enslaved persons recorded by given name only; medieval | `surname` NULL | Already allowed. `sort_name` falls back to given. Document |
| Generation names, clan names | Chinese generation name shared across siblings; Scottish/Somali clan | Neither given nor surname | `parts` JSON overflow column with typed entries — GEDCOM X's NamePart qualifiers (`Familiar, Religious, Geographic, Occupational, Postnominal, RootName, Characteristic`). Rare enough not to earn columns; real enough not to be dropped |
| Name known only by relation | "Mrs John Smith"; "the widow Kowalska" | Given empty, prefix "Mrs", surname "Smith" | Fits. Type `other`, phrase "recorded as wife of" |

### 4.5 Names have dates and causes

A married name begins at a marriage. An immigrant name begins on arrival. A
religious name begins at profession. Today a name floats free of time.

Add an optional `event` FK on `person_names` → `events` (the marriage, the
naturalisation, the profession). When the event has a date, the name has one.
A separate five-column date on the name row is the alternative; it duplicates
what the event already knows. `Schema · S2` (needs events).

### 4.6 Searching what people actually search

*Kowalska / Kowalsky / Kovalska / Kowalskÿ* — thirty years of one clerk's
spelling. The brief says the name is "the thing people search on," and exact
match will not find it.

- `unaccent` + lowercase generated column `surname_norm`, `given_norm`.
- `pg_trgm` GIN index on both — substring and similarity search, one extension.
- `fuzzystrmatch` for `dmetaphone` where trigrams are not enough. Daitch–Mokotoff
  (Eastern European Jewish names) is not in Postgres; it is a 200-line
  function if wanted later.
- The display name and sort name are already cached; the search columns are the
  third and last cache on this table.

`DDL · S4` (before the public site has a search box).

### 4.7 Script and language

`script_original` holds the untransliterated form. Add `lang` (BCP 47: `he`,
`ar`, `ru`, `zh-Hant`) so a renderer can choose direction and font, and so two
romanisations of one Hebrew name (`aka` rows) declare what they are
romanisations *of*. `Schema · Now` (cheap; retrofitting means guessing).

---

## 5. Parentage

### 5.1 The lineage vocabulary

| Value | Meaning | Descent? (in the cycle check) | Note |
|---|---|---|---|
| `birth` — **rename from `biological`** | The record presents this as the child's parent by birth | yes | GEDCOM 7's `BIRTH`. A baptism register does not prove genetics; "biological" claims what only DNA can. Default value |
| `adoptive` | Legal adoption | yes | Adult adoption exists (Japan, US). Adopting one's own ancestor is theoretically legal and would be refused; document the exception, keep the rule |
| `step` | Parent's partner | **no** | The "own grandpa" case |
| `foster` | Care placement | **no** | Often has a period; link to an event |
| `guardian` | Legal guardianship | **no** | GEDCOM treats as an association; we keep it here so the child's form shows it |
| `donor` | Gamete donor | yes | Genetic, not legal or social |
| `surrogate` — **add** | Gestational carrier | yes | Not the same as donor; a child can have both, plus two intended parents — four edges, all true |
| `sealing` — **add, optional** | LDS ordinance | no | Only for GEDCOM round-trip fidelity; hide unless the tree opts in |
| `other` + `lineage_phrase` — **add** | Anything else | no | Godparents are **not** parentage — see §7 |

✅ Renamed. `migrations.ts` carried the nine rows across; `birth` is the default.

### 5.2 Edges are assertions

The brief lists *disputed parentage* among the ordinary cases. An edge needs:

- `confidence` — GEDCOM `QUAY` 0–3 (`unreliable`, `questionable`, `secondary`,
  `primary`), the scale exports cleanly to.
- `status` — `asserted` | `disputed` | `disproven` | `conclusion`. A disproven
  edge is **kept**, marked, and hidden from charts: the point of evidence is
  that the wrong answer stays on file with the reason it is wrong.
- citations via the polymorphic junction (§9).
- `event` FK — the adoption order, the fostering placement, the guardianship
  grant. Gives the edge a date without a second date model.

Charts render `status IN ('asserted','conclusion')`. `Schema · S5`, but
`status` and `confidence` are cheap enough for `Now`.

### 5.3 More than two parents

Two biological, two adoptive; donor + surrogate + two intended; three legal
parents (British Columbia, Ontario, California permit it); mitochondrial
donation (three genetic contributors, UK since 2015). The edge model holds all
of it with no schema change. Two things to write down:

- **No constraint limits parent count**, and none should.
- The data-quality report flags `> 2` edges of lineage `birth` on one child, because it is *usually* a duplicate — a warning, per principle 2.

### 5.4 Uniqueness per lineage — one theoretical gap

`UNIQUE (parent, child, lineage)` blocks an adoption revoked and re-done between
the same two people. Two rows would want two dates. Acceptable: the event FK
carries the history; document.

### 5.5 Siblings, twins, birth order

- **Siblings are derived**, as the brief says: shared parent → half; shared both
  → full; via `step` edges → step; via `adoptive` → adoptive. The query is a
  self-join on `parentage`; write it once in `docs/queries.md`.
- **Twins are not derivable from shared parents** — they need the same birth
  date, and dates may be missing. Add `multiple_birth` (uuid, nullable) on
  `persons`: siblings sharing the value are one birth; ordinal within it from
  `parentage.sort`. GEDCOM has no twin marker (it relies on identical dates), so
  export drops it; import cannot recover it. `Schema · S2`.
- **Birth order** without dates: `parentage.sort` (§3).

### 5.6 Plausibility, never constraints

Mother under 12 or over 55; father under 12 or over 90; child born more than
ten months after father's death or after mother's death; child born before a
parent; a `birth` edge where parent and child are the same sex and there are
already two — all **warnings** in the data-quality report (§15). Registers
record all of these, some correctly.

---

## 6. Couples

| Case | Example | Today | Proposal | Where · When |
|---|---|---|---|---|
| Same-sex union | Two women, married 2015 | Allowed — no sex constraint anywhere | Keep. Say so explicitly in the collection note; it is a deliberate property, not an omission | Docs · Now |
| Polygamy, polyandry, concurrent unions | Three wives | Three rows | Fine. Order by first union event date, then `sort` | Schema (`sort`) · S2 |
| Marry, divorce, remarry each other | Burton and Taylor | Second row refused by the sorted-pair index | **Keep the index.** One row, four events (marriage, divorce, marriage, divorce). Principle 7. Document prominently — it is the first "bug" someone will report | Docs · Now |
| Union with no marriage | Cohabitation; a child from a brief relationship | Row with no events | Correct and intended. `couples` asserts a union existed; events say what kind. Consider a `type` summary only if the UI needs a label before events exist — prefer not | Docs · Now |
| Two parents who were never a couple | Donor conception; assault | No `couples` row; two `parentage` edges | Correct. Document that `couples` is not required for parentage and the renderer must not synthesise one | Docs · Now |
| One partner unknown | Child of a known mother, father unknown | No couple, one edge | Correct. Do not create an "unknown" placeholder person for the partner unless an edge needs it (§3) | Docs · Now |
| Partner is a descendant / ancestor | Ptolemaic sibling marriage; documented father-daughter cases | Allowed | Allowed — it happened. **Warning** in the data-quality report, never a constraint | Flow · S2 |
| Children *of the couple* | Which children belong to this union? | Derived: children with a `birth`/`adoptive` edge from **both** partners | Document the derivation. Children of one partner only are the other's step-children — also derived | Docs · Now |
| Events the couple needs | marriage, banns, licence, contract, engagement, separation, annulment, divorce, civil union, domestic partnership, common-law recognition, residence, census (as household) | None exist | Event types with `applies_to = couple`. §8 | S2 |
| A person's partners list | Persons form shows parents and children, not partners | No o2m possible — the pair is unordered | Resolved by the custom graph interface (build step 3). Do not fake it with two o2m fields; that reintroduces the order the index refuses | UI · S3 |

---

## 7. Associations ✅ built

Relationships that are neither descent nor union: godparent, witness,
enslaved-by (the most important one for African-American genealogy, where the
enslaver's records are often the only records), employer, apprentice-to,
neighbour, informant on a death certificate, executor. GEDCOM 7 `ASSO` with
`ROLE`; GEDCOM X event roles.

Half of these are **roles in an event** (witness, godparent, informant) and
belong in `event_participants` (§8.4). The other half are **standing
relationships** with a period (enslaved-by, apprenticed-to, employer). Add
`associations(tree, person_a, person_b, type, from/to dates via event or the
five columns, notes)`. Not unordered — *enslaved-by* has a direction. Two
collections in the budget (§14.4); both `S2`, because the events they hang off
arrive then.

---

## 8. Events and dates ✅ built

Everything here is `S2`, and *S2 had to precede data*. It did: the five
columns, the CHECKs on the qualifier's shape, the GiST index over
`daterange(earliest, latest)`, `event_types` as a collection,
`event_participants` and the death → `is_living` trigger all shipped before
the seed ran. The rows marked **⟂ built differently** below say where the
implementation diverged from the proposal and why.

### 8.1 The date model, extended

The five columns stand. Six additions, all found by trying to write real dates
into them:

| Case | Example | Problem | Proposal |
|---|---|---|---|
| Period vs uncertain point | `FROM 1850 TO 1855` (lived there five years) vs `BET 1850 AND 1855` (born once, sometime) | One qualifier `between` cannot mean both | Add `period` to the qualifier enum. Sorting and display differ: a period is drawn as a bar |
| Open ends | `BEF 1900`, `AFT 1850` | `earliest = NULL` breaks range queries and sorts | **⟂ built differently:** NULL, not `±infinity`. Directus cannot render an infinite date, and `daterange(NULL, x)` already means unbounded — so the GiST index below gets the right semantics and the form stays usable. The qualifier disambiguates "unbounded" from "unparsed" |
| Phrase only | "Easter 1720"; "the winter grandmother died"; "after the war" | No range | Qualifier `phrase`; `earliest`/`latest` NULL; `date_original` is all there is. Sorts last. GEDCOM 7 `PHRASE` round-trips it |
| Dual dating | `1750/51` — 24 Feb 1750/51 in England | Which year sorts? | `calendar = julian`, and **`earliest`/`latest` are always proleptic Gregorian.** The original keeps the slash. Conversion offsets: 10 days to 1700, 11 to 1800, 12 to 1900, 13 after; England's year began 25 March until 1752; Sweden had a 30 February in 1712. This is a library, not a trigger |
| Other calendars | Hebrew (tombstones), French Republican (1793–1805), Hijri (lunar — conversion ±1 day, genuinely), Japanese eras (*Meiji 5*), Ethiopian, Coptic, Quaker numbered months (with the same year-start trap) | `calendar` enum too short | Extend the enum; store normalised Gregorian range; convert in the hook that parses `date_original`. Hijri conversions record `qualifier = about` when the day is ambiguous — the model already has a word for that |
| Age instead of date | Death certificate: "aged 74" | The birth year is *calculated* | `age_recorded` text on the event (GEDCOM `AGE`). The calculated birth gets `qualifier = calculated` and a citation to the death event. Keep the age — it is the evidence |
| Time of day | Twins' birth order; astrological records | Rare | `time` column, nullable. Do not use `timestamp`: historical dates have no timezone and must not be shifted |
| Range validity | `earliest > latest`; `exact` with a range | Bad data | `CHECK (date_earliest <= date_latest)`; `CHECK (qualifier <> 'exact' OR date_earliest = date_latest)`; `CHECK (qualifier <> 'before' OR date_earliest = '-infinity')` etc. `DDL` |
| Querying ranges | "everyone alive in 1881" (for a census) | Two-column comparisons everywhere | **⟂ built differently:** a functional GiST index over `daterange(date_earliest, date_latest, '[]')`, no column. A generated column of a type Directus cannot render would appear in the schema snapshot and a push could not recreate it; an expression index is invisible to Directus and any query using the same expression uses it |
| "About" width | `ABT 1850` — how wide? | Undefined in GEDCOM | Convention, per tree, with defaults: `about` ±5 years for a year, ±1 month for a month; `estimated` ±10 years; `calculated` ±1 year. `trees.date_conventions` JSON. Document that the range is a search aid, not a claim |

Parsing `date_original` into the four derived columns is a **hook**, not a
trigger: the GEDCOM date grammar plus calendars is a real parser and belongs in
TypeScript with tests. The `CHECK`s above are what the database enforces on
the result.

### 8.2 Event types are a collection

`event_types(code, label $t:, applies_to person|couple|either, is_vital,
gedcom_tag, sort, tree NULL = global)`. Seed from GEDCOM 7's individual events
(`BIRT CHR DEAT BURI CREM ADOP BAPM BARM BASM BLES CHRA CONF FCOM ORDN NATU
EMIG IMMI CENS PROB WILL GRAD RETI EVEN`), attributes (`CAST DSCR EDUC IDNO
NATI NCHI NMR OCCU PROP RELI RESI SSN TITL FACT`), family events (`ANUL CENS
DIV DIVF ENGA MARB MARC MARR MARL MARS RESI EVEN`), plus the ones GEDCOM lacks
and users need: `stillbirth`, `military_service`, `military_discharge`,
`apprenticeship`, `land_transaction`, `court_appearance`, `manumission`,
`heimat`, `funeral`, `inquest`, `dna_test`. A tree may add its own (`tree` set);
global rows are admin-owned.

`is_vital` marks birth/death/marriage-class events for the timeline summary and
for the `is_living` trigger. `gedcom_tag` NULL means export as `EVEN` with
`TYPE`.

### 8.3 Attributes have values

`OCCU Blacksmith`, `RELI Roman Catholic`, `DSCR 5'10", red hair`, `NCHI 7`. Add
`value` (text) on `events`. Cause of death is `value` on the death event, not a
column on the person.

### 8.4 Events have many people in them

A baptism: child, two parents, two godparents, an officiant. A census: a
household of eight. A marriage: two spouses, two witnesses. A will: testator,
beneficiaries, witnesses, executor. `subject_person | subject_couple` names the
row the event is *filed under*; everyone else needs a place.

`event_participants(tree, event, person, role)` with roles from a lookup or a
short enum: `principal, spouse, parent, child, witness, godparent, officiant,
informant, beneficiary, executor, household_member, employer, enslaver`.
Privacy: a participant row that names a living person is filtered like a name
row (§13). This is also how a census *household* is modelled — one event, many
participants, one place, one date — rather than eight separate census events
that nobody can see belong together.

Keep `subject_*` as direct columns: the policy filter needs one hop, and "whose
timeline does this appear on" needs one answer.

### 8.5 Exactly one subject

`CHECK ((subject_person IS NULL) <> (subject_couple IS NULL))`. `DDL`.

### 8.6 Places on events

`place` FK to `places`, and `place_original` text — the string as written
(*Danzig, Westpreußen*), by principle 1. The FK is the normalisation; the text
is the evidence.

### 8.7 Ordering and privacy

`sort` for same-date events (baptism after birth on the same day). `is_restricted`
(§3). Event `notes` are never public; add `description` for the publishable
sentence.

---

## 9. Evidence — sources, citations, assertions (S5)

The brief's target is the Genealogical Proof Standard: conflicting evidence
kept, weighed, one conclusion marked. The full GEDCOM X model (source →
persona → conclusion person) is more machinery than any desktop tool ships.
The pragmatic model that still meets the standard:

### 9.1 Three tables

- `repositories(name, type archive|library|website|private, address, url)` —
  where sources live.
- `sources(repository, title, author, publication, type original|derivative|
  authored, url, notes)` — the 1881 census, a parish register, a gravestone,
  a family bible, a book.
- `citations(source, locator "p. 42, entry 17", url, image → media,
  transcription, date_accessed, information primary|secondary|undetermined,
  evidence direct|indirect|negative, confidence 0–3, notes)` — the specific
  place in the source and what it says.

The `information / evidence / source-type` triad is Evidence Explained's and
BCG's; three enums cost nothing and let a later UI compute "how well proven is
this fact" honestly.

### 9.2 What a citation attaches to

A name, an edge, an event, a couple, a person's sex. Polymorphic. Directus has
**M2A** (many-to-any) natively: `citation_links(tree, citation, item
collection+id)`. The junction carries `tree` so the tree-agreement trigger and
the public filter cover it. Alternative — one junction per target — is five
tables for one idea.

### 9.3 Conflicting assertions and the conclusion

Two birth events on one person, each cited, is the intended representation of
"two censuses give different years." Add `is_conclusion` on `events` with a
**partial unique index**: `UNIQUE (subject_person, type) WHERE is_conclusion`
— at most one conclusion per fact type per person. The chart shows the
conclusion; the person page shows all of them with their confidence, because
"conflicting evidence is a feature to display." Same mechanism on `parentage`
via `status = conclusion`.

### 9.4 Negative evidence

"Searched the 1861 census for the whole parish; not present." A citation with
`evidence = negative` attached to the person (not to an event). It is the
research log's most valuable entry and the one every tool loses.

### 9.5 Research tasks

`research_tasks(tree, person, question, source_to_check, status open|done|
dead_end, notes)`. Standard in Gramps and RootsMagic; small; `Later` unless the
user wants the workflow early.

### 9.6 Citation formatting

Evidence Explained has ~1,000 templates. Non-goal to implement them. Store the
structured fields plus a free `citation_text` the user writes; render templates
if ever, from the fields.

---

## 10. Places (S6)

| Case | Example | Proposal |
|---|---|---|
| Names change | Danzig → Gdańsk; Königsberg → Kaliningrad; Constantinople → Istanbul | `place_names(place, name, lang, valid_from, valid_to)` as the brief says. Display the name **valid at the event's date** — the event's `date_earliest` picks the name |
| Hierarchy changes | A village moved from one county to another in 1974; Prussia ceased to exist | `parent_place` is the *current* parent. Historical jurisdiction is a note plus the `place_original` string on each event, which preserves what the record said. Fully dated hierarchies (Gramps) are out of proportion for now; document the limit |
| Type | country, state, county, parish, city, village, hamlet, farm (Norwegian *gård* — genealogically a surname source), manor, cemetery, church, hospital, address, ship, at sea, unknown | **⟂ built differently:** an enum of 23 values with `other`, not a lookup table. The set is close to closed, and it saved a collection at core tier when that still mattered. Ships and "at sea" are in it |
| Coordinates | A country centroid vs a house | `lat, lng, precision (country|region|settlement|address)` — so a map does not draw a country at a street's zoom |
| Gazetteer identity | The same Gdańsk in every tree | `geonames_id, wikidata_id, gov_id` (GOV — Genealogisches Orts-Verzeichnis, the German genealogy standard). Lets two trees agree on a place without sharing rows |
| Tenancy | "Grandma's house, 12 Oak St" is private; Gdańsk is not | Places carry `tree` (principle 4). A shared read-only gazetteer tier is `Later`; the external ids above are the bridge to it |
| **Privacy leak through places** | A living person's residence event is filtered; the `places` row *12 Oak Street* is public if `tree.is_public` | Public policy on `places`: `type NOT IN ('address')` **and** the place is referenced by at least one public event — the second half is not flat. Resolution: trigger-maintained `places.has_public_reference` boolean. Principle 5 |
| Duplicates within a tree | "Gdańsk" and "Gdansk" and "Danzig" as three rows | Autocomplete in UI; a report by `unaccent(name)` similarity. Merge is a UI feature `Later` |

---

## 11. Media, including the avatar

| Case | Proposal | Where · When |
|---|---|---|
| **The avatar** | `persons.portrait → directus_files`. The user's choice, not "the earliest photo" | Schema · S3 |
| **The bytes leak before the row does** | Enamel's hard lesson: hiding a document *row* did not hide `/assets/<uuid>`. `directus_files` answers on its own permissions. So files carry `tree` and a trigger-maintained `is_public_ok` (true only when every tagged subject is dead, `is_restricted` false, licence permits). The public policy on `directus_files` filters both. **This gates the avatar feature**; do not ship the portrait field before the file policy | Schema + DDL + Policy · S3 |
| One photo, many people | `media_subjects(tree, file, person, region x,y,w,h nullable)`. The region is how a face in a 1920 wedding photo becomes a link | Schema · S3 |
| Attached to anything | Person, event (a certificate scan), citation (the document image), place (the church), couple (the wedding). M2A `media_links` | Schema · S5 |
| Provenance | Who took it, when (a five-column date — photographs are undated too), `copyright_holder`, `licence` (`all_rights_reserved` \| `cc_by` \| `cc_by_sa` \| `public_domain` \| `unknown`), `publishable` boolean derived from licence | Schema · S3 |
| Kinds | Photo, document scan, audio (oral history — with `transcript` and time-coded notes), video, a GEDCOM file itself | `directus_files.type` covers MIME; add `kind` and `transcript` on a `media` metadata row rather than on `directus_files` | Schema · S3 |
| EXIF | A phone photo of a living cousin's house carries GPS coordinates | Strip EXIF on upload for anything marked publishable; Directus transforms can, or a hook | Hook · S4 |
| Growth | Photos are the only thing that grows without bound per tree | `trees.storage_quota_bytes`, usage computed nightly; S3-compatible storage adapter when self-hosted disks stop being funny | Flow · Later |
| Originals vs derivatives | A 60 MB TIFF scan and its web JPEG | Directus generates transforms on demand; keep the original. Set `ASSETS_TRANSFORM_MAX_*` | Config · S3 |

---

## 12. Trees, membership, sharing

### 12.1 Settings a tree needs

`living_cutoff_years` (100), `privacy_years_after_death` (0; some families and
jurisdictions want more — see §13.2), `default_name_order`,
`particle_sorting`, `default_calendar`, `date_conventions` JSON (§8.1),
`language`, `home_person → persons` (where the public site opens),
`description` (the public blurb), `cover_image`, `is_listed` (public but
**unlisted** — reachable by URL, absent from any index; distinct from
`is_public`). `Schema · S4`.

### 12.2 Ownership survives the owner

Genealogists die; the tree is what the family wants. §2.7's trigger keeps at
least one owner. Add `trees.legacy_contact` (email) and a documented procedure
for transferring ownership on a death certificate — an operational note, not a
feature, until it is needed.

### 12.3 Invitations

`tree_invitations(tree, email, role, token, invited_by, expires_at,
accepted_at)`. On acceptance a `tree_members` row is created by a flow. Standard
and unavoidable once there is a second user. `Schema + Flow · S4`.

### 12.4 Sharing a private tree by link

Directus has `directus_shares` — item-level, password-optional, expiring. Use
it for "here is grandmother's page" rather than building token URLs. Note that
a share of a private tree's person **must not** include living people unless
the sharer opts in: `includes_living` as a share field. `Config + Docs · S4`.

### 12.5 Roles

`owner | editor | contributor | viewer` suffice. Two refinements when asked:
`viewer_public` (sees only what the public would, for a private tree — a
distant relative who should not see the living) and `commenter` (Directus
comments only). Not now.

### 12.6 Deletion and export

Tree deletion cascades to everything. Make it two steps: `status = deleting`
(hidden, recoverable, 30 days), then a flow that **exports GEDCOM + JSON to the
owner's email** before the hard delete. GDPR's right to erasure and right to
portability meet here, and a genealogist who deletes a tree in anger on Tuesday
wants it back on Thursday. `Schema + Flow · S7` (needs export).

### 12.7 Slugs

Global unique already. Add a reserved list (`admin, api, www, static, trees,
persons`) as a `CHECK`, and refuse changing a slug once `is_public` has ever
been true — shared URLs are promises. Or keep `tree_slug_history` and redirect.
The first is simpler. `DDL · S4`.

---

## 13. Privacy and the living, in depth

### 13.1 The boolean stays; it gains provenance and a sibling

- `is_living` — the policy column. Unchanged.
- `living_basis` — why the boolean says what it says (§3).
- `is_restricted` — a wish, not a legal status; on persons, events, edges,
  media (§3). The public filter is `is_living = false AND is_restricted =
  false`. Still two flat comparisons.

### 13.2 Embargo after death

German civil records: 110 years from birth or 30 from death; French: 75 years;
several families: "not while his widow is alive." A per-tree
`privacy_years_after_death` and a nightly flow that keeps `is_restricted = true`
until the death date plus the embargo has passed, then clears it — **into the
boolean**, per principle 5. The filter never learns about dates.

### 13.3 Everything that can reach a living person

Enumerated, because each is a filter that has to exist:

| Row | Filter (in addition to `tree.is_public`) |
|---|---|
| `persons` | `is_living = false AND is_restricted = false` |
| `person_names` | `person.is_living = false AND person.is_restricted = false` |
| `parentage` | both endpoints not living, not restricted, `is_restricted = false` |
| `couples` | both partners not living |
| `events` | subject not living; **and no participant living or restricted** — trigger-maintained `has_living_participant` boolean, because "no participant is living" is not flat. ✅ |
| `event_participants` | `person.is_living = false` |
| `associations` | both persons not living |
| `citations`, `citation_links` | the linked item's rule — hardest one; M2A filters are awkward. Resolution: `citation_links.is_public_ok` trigger-maintained |
| `media_subjects` | `person.is_living = false` |
| `directus_files` | `is_public_ok` (§11) |
| `places` | `type <> 'address' AND has_public_reference` (§10) |
| `trees` | `is_public` — and `is_listed` for the index page |

Every one of these is a `verify.ts` check in both directions, gated on the
positive check that the public read works at all.

### 13.4 Erasure and access requests

A living person who is in a cousin's tree and objects. Needed: a query that
finds every row naming a person (names, edges, participants, media subjects,
associations, citations) — the table above *is* that list — and a
`stemma_anonymise_person(id)` function that removes names, media links,
participant rows and notes while **keeping the node** so the graph stays
connected (their children still have a parent; it is just unnamed and
restricted). Deleting the node would orphan descendants' ancestry, which is
somebody else's data. `DDL · S4` — before the public site exists, because that
is when requests start.

### 13.5 Minors

All living, so all suppressed. Nothing further at the model layer; a UI warning
when a birth date is under 18 is a courtesy.

### 13.6 What is *not* protected and should be said

The **existence** of a living person is inferable from gaps: a dead couple with
visible children numbered 1, 2, 4. Accepted; the alternative is hiding the dead
too. Document as a known, bounded leak.

---

## 14. Scale — how far this grows

### 14.1 Rows

A serious hobby tree: 5–20k persons. A one-name study or regional
reconstruction: 100k–1M. FamilySearch: 1.5 billion — not this product.
Postgres with the indexes already in place is comfortable to 100M rows; the
question is never total rows but per-query row visits.

### 14.2 The acyclicity walk

Cost per insert is the size of the proposed parent's *ancestor set*, bounded by
the tree's persons because edges are tree-scoped. In a 20k-person tree that is
typically a few hundred rows via the `child` index — sub-millisecond. Pedigree
collapse *reduces* it (`UNION` dedupes). Two ways it gets expensive:

- **Bulk import** of 50k edges = 50k walks. Minutes. Strategy: import inside one
  transaction with the trigger disabled (`ALTER TABLE parentage DISABLE
  TRIGGER stemma_parentage_acyclic`), then one whole-graph check — a single
  recursive CTE that detects any cycle — before commit; roll back if it finds
  one. Same transaction, so no window. `Docs · S7` (import).
- **The advisory lock** (§2.1) serialises edge writes per tree. At human editing
  speed this is unobservable; a parallel importer must use one connection per
  tree.

### 14.3 Graph queries the product will need

- Ancestors / descendants to *n* generations: recursive CTE, indexed both ways
  already. Cap at a depth (30 generations ≈ 900 years) as a safety rail.
- Relationship between two people ("how am I related to X"): lowest common
  ancestors via two ancestor CTEs and an intersection; the *set* of LCAs, since
  pedigree collapse yields several. Return all paths; the renderer picks.
- Numbering (Ahnentafel, d'Aboville, Henry, Register): computed at render, never
  stored. Under collapse one person legitimately holds two Ahnentafel numbers —
  that is the feature working.
- Coefficient of relationship / inbreeding: computable from the DAG in SQL;
  `Later`, but it is one of the few things a DAG store can do that a tree store
  cannot.
- If a tree ever exceeds ~200k persons, a trigger-maintained **transitive
  closure** (`ancestry(ancestor, descendant, depth)`) turns every ancestor query
  into an index lookup at the cost of O(n·depth) rows. Not now; it is the known
  answer.

### 14.4 The collection budget

Core tier: **25 collections.** Planned total: the six built + `events,
event_types, event_participants, associations, places, place_names, place_types,
repositories, sources, citations, citation_links, media, media_subjects,
media_links, research_tasks, tree_invitations` = 22. Tight but inside — and
irrelevant once the licence key is in. Note it so nobody adds a lookup table
casually at core tier.

### 14.5 What grows without bound

- **Media bytes** — quotas (§11).
- **`directus_revisions`** — every field change on every row, forever. Core tier
  keeps 30 days; licensed instances should set a retention policy deliberately.
  Genealogists want *permanent* change history ("who added this edge, when,
  citing what") — that is the research log's job (§9.5), not the revisions
  table's.
- **`directus_activity`** — same.
- **Public site traffic** — a public tree is static-shaped; cache per tree on
  `date_updated`, invalidate on any write to that tree.

### 14.6 Multi-tenancy at scale

One database, `tree` on every row, indexes on `(tree, …)`. Postgres row-level
security would be defence-in-depth, but Directus connects as one role and does
not set a per-request session variable, so RLS cannot know the user. The
tenancy boundary is the policy plus `verify.ts` — say so plainly rather than
half-implement RLS.

### 14.7 Concurrency beyond edges

The display-name trigger recomputes from scratch — idempotent, safe under
concurrency. Name `sort_order` collisions resolve deterministically by id.
Nothing else in the built schema has a read-then-write pattern. Every future
trigger that *checks* before it *writes* gets the same advisory-lock treatment
as §2.1 — write that rule into constraints.ts's header.

---

## 15. Data quality — the report, not the constraint

Gramps ships forty of these; RootsMagic calls them "problem search." All are
`SELECT`s over the seeded model, none are rules. A `data_issues` view (or a
nightly flow into a small `data_issues` table so the admin can list them):

- parent under 12 / mother over 55 / father over 90 at child's birth
- child born after mother's death, or > 10 months after father's
- burial before death; baptism > 5 years after birth; death before birth
- lifespan > 110
- marriage before age 12; spouse age gap > 40 years (information, not error)
- siblings born < 9 months apart and not marked `multiple_birth`
- more than 2 `birth` edges on one child
- a loop through `step`/`foster`/`guardian` edges (legal, usually a mistake)
- partner is also an ancestor or descendant (§6)
- person with no edges, no events, no names — disconnected node
- two persons in one tree with `unaccent` similarity > 0.8 and birth years ± 2
- event with no citation (for trees that opt into "cite everything")
- `is_living` with birth earlier than `living_cutoff_years` (§3)
- a name with `type = married` on a person with no couple

Each row: `tree, kind, severity info|warning, item collection+id, detail`.
`Flow + Schema · S2`.

---

## 16. Export and import edge cases (S7)

GEDCOM 7 export is a mapping; the model was chosen to make it one. Where the
mapping is lossy, the loss is GEDCOM's and should be recorded, not silently
dropped:

- `persons → INDI`; `couples → FAM` with `HUSB/WIFE` (GEDCOM 7 permits either sex
  in either role); children of a couple → `CHIL`.
- **Parents who were never a couple**: GEDCOM requires a child's `FAMC` to
  point at a `FAM`. Synthesise a `FAM` per distinct parent-pair (and per single
  parent), flagged `_STEMMA_SYNTHETIC` so re-import can drop it.
- **More than two parents**: GEDCOM has no representation. Emit the first two
  by lineage priority (`birth` first) and the rest as `ASSO` with a `PHRASE`.
  Record the loss in the export log.
- `lineage → PEDI`: `birth→BIRTH, adoptive→ADOPTED, foster→FOSTER,
  sealing→SEALING`, everything else `OTHER` + `PHRASE`.
- Dates: `date_original` is already GEDCOM grammar or close to it; `phrase`
  dates → `DATE` with `PHRASE`. Calendars: `GREGORIAN, JULIAN, FRENCH_R, HEBREW`
  are the four GEDCOM knows; others export as phrases.
- Names: `NAME` with `GIVN, SURN, NPFX, NSFX, NICK, SPFX` (the particle — GEDCOM
  has it), `TYPE`. Patronymic → `GIVN` or `SURN` per `name_order`; loss noted.
- Twins: lost (GEDCOM relies on equal dates). Noted.
- Living people: export option `exclude | privatise (name → "Living", no
  facts) | include` — the third only for the owner's own backup.
- `is_restricted` → `RESN CONFIDENTIAL`.
- Media → `OBJE` with `FILE`; regions lost.
- Citations → `SOUR` / `REPO` / `PAGE` / `QUAY` — maps cleanly, which is why the
  0–3 scale was kept.
- **GEDCOM X JSON** export in parallel: it is nearly our model and loses almost
  nothing. Cheap once GEDCOM 7 exists.
- Import stays deferred. Note the classic traps for whoever does it: vendor
  `_CUSTOM` tags, ANSEL encoding in 5.5 files, `FAM` records with no spouses,
  dates like `1850-1855` that are not GEDCOM grammar, and the bulk-import
  trigger strategy in §14.2.

---

## 17. The collection checklist

Every new collection, before it is pulled and committed:

1. `id uuid` with `DEFAULT gen_random_uuid()` in the DB.
2. `tree` m2o, required, `CASCADE`, and an arm on `stemma_tree_agrees`.
3. Indexes on `(tree, …)` for every filter the policies will use.
4. Every m2o has both `interface` and `display`; every dropdown has `display:
   labels`; every o2m has its alias field on the far side (the pull warns if
   not).
5. Notes and labels are `$t:` keys in `strings.ts`.
6. A public permission with a **flat** filter, or an explicit note that the
   collection is never public.
7. A member permission through `tree.members`.
8. `verify.ts` checks in both directions, gated on the positive read.
9. A default list view (presets — the one thing the sync never carries).
10. A row in §13.3's table if the collection can name a living person.

---

## 18. Revised build order

The brief's order stands; this register moves a few things earlier because
they change existing rows.

*Everything under **Now**, **S2**, **S3**, **S5** and **S6** below is built.
**S4** is half built — the public *policy* is done and proven, and the
member-facing site is `apps/web`; the anonymous site is a **non-goal** as of
2026-09-20 (see CLAUDE.md). **S7** is not built. Tables cheap enough to make
ahead of time already exist: `tree_invitations`, `media*`,
`directus_files.tree`, `public_id`, the slug rules.*

**Now — before any real data:** §2 defects (advisory lock, descent-only cycle
check, block tree moves, id defaults, prevent-delete, `name_order` +
`sort_name`, owner trigger); `biological → birth`; `is_restricted`;
`biography`; name type additions + `lang` + `particle`; `parentage.status` +
`confidence`; `parentage.sort`; `couples.sort`. Then re-pull, and re-run the
sabotage suite with two new cases: the race, and the "own grandpa" step
configuration that must now be *allowed*.

**S2 — events, before data:** the extended date model with its `CHECK`s and
generated `daterange`; `event_types` as a collection; `event_participants`;
`associations`; the death → `is_living` trigger; `living_basis`;
`multiple_birth`; the data-quality view. Names and edges gain their `event` FK.

**S3 — the admin graph interface:** plus `portrait` — *gated on the file
policy* — and `media_subjects`.

**S4 — public read layer:** `public_id`, tree settings, `is_listed`,
invitations, shares, slug rules, the anonymisation function, name search
columns, EXIF stripping. Every row of §13.3 becomes a verify check.

**S5 — evidence:** the three tables, M2A links, `is_conclusion` with its
partial unique index, `media_links`.

**S6 — places:** with `has_public_reference`.

**S7 — export:** GEDCOM 7 and GEDCOM X; the two-step tree deletion.

---

## 19. Decisions that are yours

Everything above is a recommendation with a reason. These five changed the shape
enough that they should have been yours; you delegated them on 2026-09-18 and
each was taken **as recommended**:

1. **`biological → birth`.** GEDCOM 7's semantics and principle 1, against the
   brief's wording. I recommend the rename. **✅ Taken.**
2. **Affinity edges excluded from the cycle check.** Allows the "own grandpa"
   case; loses the DB refusing a mis-keyed step edge that happens to loop (it
   becomes a warning). I recommend excluding. **✅ Taken; the affinity-loop
   warning is not yet in the data-quality view.**
3. **`is_restricted` as a second boolean vs. widening `is_living`'s meaning.**
   Two booleans keep each one honest. I recommend two. **✅ Taken.**
4. **Places per tree vs. a shared gazetteer.** Per tree now, external ids as
   the bridge. Shared later only if duplicates hurt. **✅ Taken.**
5. **Event types as a collection** — it costs one of the 25 slots at core tier
   and is the right call regardless; but it means users can create types, which
   is a product decision about how opinionated the schema is. I recommend the
   collection, with global rows locked to admins. **✅ Taken; 53 global rows
   seeded; a member's attempt to create a global one is refused by the database.**
