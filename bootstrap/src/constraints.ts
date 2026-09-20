/**
 * Rules the database enforces, because nothing else can.
 *
 * ── Why this file is not in the sync ───────────────────────────────────
 *
 * Everything else about this instance travels in `directus/` as JSON that
 * `d6s sync push` applies. It carries no DDL: not CHECK constraints, not
 * unique indexes over expressions, not triggers, not extensions. Every
 * rule below would simply not exist on a freshly pushed instance, and the
 * guarantees this schema makes are all in this file.
 *
 * That is also why they are here rather than in application code. A rule
 * in a hook or a flow holds for the clients that go through it. A rule in
 * Postgres holds for every client there will ever be — the Data Studio, a
 * flow, the website's token, a psql session, a token somebody minted last
 * year and forgot. "No person may be their own ancestor" is not a
 * validation. It is a property of the data.
 *
 * ── Two disciplines every trigger here follows ─────────────────────────
 *
 * 1. **A trigger that checks before it writes takes a lock first.** Two
 *    sessions inserting the two halves of a cycle each saw an acyclic
 *    graph under READ COMMITTED and both committed; this was reproduced,
 *    not imagined. `pg_advisory_xact_lock(hashtext(tree))` serialises
 *    such writes per tree — two trees never contend — and releases at
 *    commit.
 *
 * 2. **Booleans the policy reads are maintained here, never computed in
 *    the filter.** `has_living_participant`, `has_public_reference`,
 *    `is_public_ok`: each is a question whose honest answer is a join,
 *    and a join in an access filter is slow, unindexable, and the sort of
 *    thing that fails open. So the join runs once, on write, into a flat
 *    column, and the policy compares the column.
 *
 * 3. **A trigger that writes to its own table is column-specific.** An
 *    unqualified AFTER UPDATE fires on the write it just made and recurses
 *    until Postgres runs out of stack. `UPDATE OF <the columns that change
 *    the answer>` is the whole fix, and `stemma_events_visibility` is why
 *    the rule is written here.
 *
 * Every statement is idempotent. Constraints are guarded on
 * `pg_constraint`; indexes use IF NOT EXISTS; functions and triggers are
 * CREATE OR REPLACE and re-applied every run, so a corrected rule reaches
 * an instance provisioned last month.
 */
import { Client } from "pg";
import { DB_HOST, DB_PORT, DB_DATABASE, DB_USER, DB_PASSWORD } from "./env.js";
import { log } from "./log.js";
import { COLLECTIONS } from "./authoring/index.js";
import { DESCENT_LINEAGES } from "./authoring/graph.js";
import { CITABLE } from "./authoring/evidence.js";
import { ILLUSTRATABLE } from "./authoring/media.js";

const TABLES = COLLECTIONS.map((c) => c.collection);

/** Tables carrying the five-column date. Each gets the same CHECKs. */
const DATED = ["events", "associations", "media"];

const sqlList = (xs: readonly string[]): string => xs.map((x) => `'${x}'`).join(", ");

type Constraint = {
  name: string;
  table: string;
  /** The `ADD CONSTRAINT` body — everything after the name. */
  definition: string;
  /** Why it exists, in one line, for the log. */
  because: string;
  /** Rows that would make `ADD CONSTRAINT` fail, so the run can name them. */
  offenders: string;
};

/* ── CHECK and UNIQUE ─────────────────────────────────────────────────── */

const RESERVED_SLUGS = ["admin", "api", "www", "static", "assets", "trees", "persons", "login", "logout", "about", "search", "sitemap", "robots"];

/**
 * The date-shape rules, once per dated table.
 *
 * `between` is one moment somewhere in a range; `period` is the whole
 * range; `before`/`after` leave one end open (NULL — the expression index
 * treats it as unbounded); `phrase` has no range at all. A qualifier that
 * contradicts its columns is a parse that went wrong, and the database is
 * the last place to notice.
 */
const dateChecks = (table: string): Constraint[] => [
  {
    name: `${table}_date_ordered`,
    table,
    definition: `CHECK (date_earliest IS NULL OR date_latest IS NULL OR date_earliest <= date_latest)`,
    because: "a range runs forwards",
    offenders: `SELECT id::text AS id, date_original AS detail FROM ${table} WHERE date_earliest > date_latest`,
  },
  {
    name: `${table}_date_qualifier_shape`,
    table,
    definition: `CHECK (
      date_qualifier IS NULL
      OR (date_qualifier = 'exact'  AND date_earliest IS NOT NULL AND date_earliest = date_latest)
      OR (date_qualifier = 'before' AND date_earliest IS NULL     AND date_latest IS NOT NULL)
      OR (date_qualifier = 'after'  AND date_latest IS NULL       AND date_earliest IS NOT NULL)
      OR (date_qualifier = 'phrase' AND date_earliest IS NULL     AND date_latest IS NULL)
      OR (date_qualifier IN ('about','between','period','estimated','calculated','interpreted')
          AND date_earliest IS NOT NULL AND date_latest IS NOT NULL)
    )`,
    because: "the qualifier and the range have to tell the same story",
    offenders: `SELECT id::text AS id, coalesce(date_qualifier,'?') || ' ' || coalesce(date_original,'') AS detail
                  FROM ${table} WHERE NOT (
      date_qualifier IS NULL
      OR (date_qualifier = 'exact'  AND date_earliest IS NOT NULL AND date_earliest = date_latest)
      OR (date_qualifier = 'before' AND date_earliest IS NULL     AND date_latest IS NOT NULL)
      OR (date_qualifier = 'after'  AND date_latest IS NULL       AND date_earliest IS NOT NULL)
      OR (date_qualifier = 'phrase' AND date_earliest IS NULL     AND date_latest IS NULL)
      OR (date_qualifier IN ('about','between','period','estimated','calculated','interpreted')
          AND date_earliest IS NOT NULL AND date_latest IS NOT NULL))`,
  },
];

const confidenceCheck = (table: string): Constraint => ({
  name: `${table}_confidence_scale`,
  table,
  definition: `CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 3)`,
  because: "GEDCOM's scale is 0 to 3",
  offenders: `SELECT id::text AS id, confidence::text AS detail FROM ${table} WHERE confidence NOT BETWEEN 0 AND 3`,
});

const CONSTRAINTS: Constraint[] = [
  /* ---- the graph ---------------------------------------------------- */
  {
    // The cheap half of acyclicity: the one-hop case, declaratively.
    name: "parentage_not_self",
    table: "parentage",
    definition: `CHECK (parent <> child)`,
    because: "nobody is their own parent",
    offenders: `SELECT id::text AS id, parent::text AS detail FROM parentage WHERE parent = child`,
  },
  {
    // Deliberately not UNIQUE (parent, child): a child adopted by a blood
    // relative has a birth edge and an adoptive edge between the same two
    // people, and both are true.
    name: "parentage_one_edge_per_lineage",
    table: "parentage",
    definition: `UNIQUE (parent, child, lineage)`,
    because: "the same parent, child and lineage is one fact, recorded once",
    offenders: `SELECT min(id::text) AS id, parent::text || ' → ' || child::text || ' (' || lineage || ') ×' || count(*) AS detail
                  FROM parentage GROUP BY parent, child, lineage HAVING count(*) > 1`,
  },
  confidenceCheck("parentage"),
  {
    name: "couples_not_self",
    table: "couples",
    definition: `CHECK (person_a <> person_b)`,
    because: "a couple is two people",
    offenders: `SELECT id::text AS id, person_a::text AS detail FROM couples WHERE person_a = person_b`,
  },
  {
    name: "associations_not_self",
    table: "associations",
    definition: `CHECK (person_a <> person_b)`,
    because: "an association is between two people",
    offenders: `SELECT id::text AS id, person_a::text AS detail FROM associations WHERE person_a = person_b`,
  },

  /* ---- trees -------------------------------------------------------- */
  {
    name: "tree_members_one_per_user",
    table: "tree_members",
    definition: `UNIQUE (tree, "user")`,
    because: "a member has one role in a tree, not two",
    offenders: `SELECT min(id::text) AS id, tree::text || ' / ' || "user"::text || ' ×' || count(*) AS detail
                  FROM tree_members GROUP BY tree, "user" HAVING count(*) > 1`,
  },
  {
    name: "trees_slug_lowercase",
    table: "trees",
    definition: `CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')`,
    because: "a slug ends up in a URL people email to relatives",
    offenders: `SELECT id::text AS id, slug AS detail FROM trees WHERE slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
  },
  {
    name: "trees_slug_not_reserved",
    table: "trees",
    definition: `CHECK (slug NOT IN (${sqlList(RESERVED_SLUGS)}))`,
    because: "a tree cannot squat on a route the site needs",
    offenders: `SELECT id::text AS id, slug AS detail FROM trees WHERE slug IN (${sqlList(RESERVED_SLUGS)})`,
  },
  {
    name: "trees_cutoff_sane",
    table: "trees",
    definition: `CHECK (living_cutoff_years BETWEEN 50 AND 150 AND privacy_years_after_death BETWEEN 0 AND 150)`,
    because: "a cutoff of 5 years would publish the living; 500 would publish nobody",
    offenders: `SELECT id::text AS id, living_cutoff_years::text AS detail FROM trees
                 WHERE living_cutoff_years NOT BETWEEN 50 AND 150 OR privacy_years_after_death NOT BETWEEN 0 AND 150`,
  },

  /* ---- events ------------------------------------------------------- */
  {
    name: "events_one_subject",
    table: "events",
    definition: `CHECK ((subject_person IS NULL) <> (subject_couple IS NULL))`,
    because: "an event is filed under exactly one subject",
    offenders: `SELECT id::text AS id, coalesce(subject_person::text, 'nobody') || ' / ' || coalesce(subject_couple::text, 'no couple') AS detail
                  FROM events WHERE (subject_person IS NULL) = (subject_couple IS NULL)`,
  },
  ...DATED.flatMap(dateChecks),
  confidenceCheck("events"),
  confidenceCheck("citations"),
  {
    name: "event_participants_once",
    table: "event_participants",
    definition: `UNIQUE (event, person, role)`,
    because: "a person plays a role in an event once",
    offenders: `SELECT min(id::text) AS id, event::text || ' ' || person::text || ' ' || role AS detail
                  FROM event_participants GROUP BY event, person, role HAVING count(*) > 1`,
  },

  /* ---- places --------------------------------------------------------- */
  {
    name: "places_not_own_parent",
    table: "places",
    definition: `CHECK (parent_place IS NULL OR parent_place <> id)`,
    because: "a place is not inside itself",
    offenders: `SELECT id::text AS id, name AS detail FROM places WHERE parent_place = id`,
  },
  {
    name: "place_names_valid_range",
    table: "place_names",
    definition: `CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to)`,
    because: "a name is valid forwards in time",
    offenders: `SELECT id::text AS id, name AS detail FROM place_names WHERE valid_from > valid_to`,
  },
  {
    name: "places_coordinates_on_earth",
    table: "places",
    definition: `CHECK ((lat IS NULL AND lng IS NULL) OR (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180))`,
    because: "a coordinate is a pair, on the planet",
    offenders: `SELECT id::text AS id, name AS detail FROM places
                 WHERE NOT ((lat IS NULL AND lng IS NULL) OR (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180))`,
  },

  /* ---- junctions -------------------------------------------------------- */
  {
    name: "citation_links_once",
    table: "citation_links",
    definition: `UNIQUE (citation, collection, item)`,
    because: "a citation supports a fact once",
    offenders: `SELECT min(id::text) AS id, collection || '/' || item AS detail FROM citation_links GROUP BY citation, collection, item HAVING count(*) > 1`,
  },
  {
    name: "citation_links_known_collection",
    table: "citation_links",
    definition: `CHECK (collection IN (${sqlList(CITABLE)}))`,
    because: "a citation points at something the model knows how to check",
    offenders: `SELECT id::text AS id, collection AS detail FROM citation_links WHERE collection NOT IN (${sqlList(CITABLE)})`,
  },
  {
    name: "media_links_once",
    table: "media_links",
    definition: `UNIQUE (media, collection, item)`,
    because: "a picture illustrates a thing once",
    offenders: `SELECT min(id::text) AS id, collection || '/' || item AS detail FROM media_links GROUP BY media, collection, item HAVING count(*) > 1`,
  },
  {
    name: "media_links_known_collection",
    table: "media_links",
    definition: `CHECK (collection IN (${sqlList(ILLUSTRATABLE)}))`,
    because: "media attaches to something the model knows",
    offenders: `SELECT id::text AS id, collection AS detail FROM media_links WHERE collection NOT IN (${sqlList(ILLUSTRATABLE)})`,
  },
  {
    name: "media_subjects_once",
    table: "media_subjects",
    definition: `UNIQUE (media, person)`,
    because: "a person is in a photograph once",
    offenders: `SELECT min(id::text) AS id, media::text || ' ' || person::text AS detail FROM media_subjects GROUP BY media, person HAVING count(*) > 1`,
  },
  {
    name: "media_subjects_region_shape",
    table: "media_subjects",
    definition: `CHECK ((x IS NULL AND y IS NULL AND w IS NULL AND h IS NULL)
                     OR (x BETWEEN 0 AND 1 AND y BETWEEN 0 AND 1 AND w BETWEEN 0 AND 1 AND h BETWEEN 0 AND 1))`,
    because: "a face region is four fractions or nothing",
    offenders: `SELECT id::text AS id, x::text AS detail FROM media_subjects
                 WHERE NOT ((x IS NULL AND y IS NULL AND w IS NULL AND h IS NULL)
                     OR (x BETWEEN 0 AND 1 AND y BETWEEN 0 AND 1 AND w BETWEEN 0 AND 1 AND h BETWEEN 0 AND 1))`,
  },
];

/* ── indexes ─────────────────────────────────────────────────────────── */

const INDEXES: Array<{ name: string; definition: string; because: string }> = [
  {
    // (a, b) and (b, a) are one union. Normalising the order on write
    // holds only for writers that remember; this holds for all of them.
    name: "couples_unordered_pair",
    definition: `CREATE UNIQUE INDEX IF NOT EXISTS couples_unordered_pair
                   ON couples (LEAST(person_a, person_b), GREATEST(person_a, person_b))`,
    because: "(a, b) and (b, a) are the same union",
  },
  {
    name: "tree_members_user_tree",
    definition: `CREATE INDEX IF NOT EXISTS tree_members_user_tree ON tree_members ("user", tree)`,
    because: "every contributor read is a membership subquery",
  },
  {
    // The public filter reads exactly these three.
    name: "persons_tree_visibility",
    definition: `CREATE INDEX IF NOT EXISTS persons_tree_visibility ON persons (tree, is_living, is_restricted)`,
    because: "the public read filters on exactly these columns",
  },
  {
    name: "persons_public_id",
    definition: `CREATE UNIQUE INDEX IF NOT EXISTS persons_public_id ON persons (tree, public_id)`,
    because: "the public URL for a person is unique within the tree",
  },
  {
    name: "persons_sort_name",
    definition: `CREATE INDEX IF NOT EXISTS persons_sort_name ON persons (tree, sort_name)`,
    because: "lists sort by surname",
  },
  {
    name: "parentage_child_idx",
    definition: `CREATE INDEX IF NOT EXISTS parentage_child_idx ON parentage (child)`,
    because: "the ancestor walk joins on child, once per generation",
  },
  {
    name: "parentage_parent_idx",
    definition: `CREATE INDEX IF NOT EXISTS parentage_parent_idx ON parentage (parent)`,
    because: "descendant charts walk the other way",
  },
  {
    name: "person_names_person_sort",
    definition: `CREATE INDEX IF NOT EXISTS person_names_person_sort ON person_names (person, sort_order)`,
    because: "the display name is the lowest-sorted name",
  },
  {
    // Kowalska / Kowalsky / Kovalska: thirty years of one clerk's
    // spelling. Trigram indexes on an accent-stripped, lowercased form
    // are what makes "the name people search on" searchable.
    name: "person_names_surname_trgm",
    definition: `CREATE INDEX IF NOT EXISTS person_names_surname_trgm
                   ON person_names USING gin (stemma_norm(surname) gin_trgm_ops)`,
    because: "fuzzy search on surnames",
  },
  {
    name: "person_names_given_trgm",
    definition: `CREATE INDEX IF NOT EXISTS person_names_given_trgm
                   ON person_names USING gin (stemma_norm(given) gin_trgm_ops)`,
    because: "fuzzy search on given names",
  },
  {
    name: "associations_a",
    definition: `CREATE INDEX IF NOT EXISTS associations_a ON associations (person_a)`,
    because: "a person's associations, forwards",
  },
  {
    name: "associations_b",
    definition: `CREATE INDEX IF NOT EXISTS associations_b ON associations (person_b)`,
    because: "and backwards",
  },
  {
    name: "events_subject_person",
    definition: `CREATE INDEX IF NOT EXISTS events_subject_person ON events (subject_person, type)`,
    because: "a person's timeline",
  },
  {
    name: "events_subject_couple",
    definition: `CREATE INDEX IF NOT EXISTS events_subject_couple ON events (subject_couple, type)`,
    because: "a couple's history",
  },
  {
    name: "events_place",
    definition: `CREATE INDEX IF NOT EXISTS events_place ON events (place)`,
    because: "everything that happened somewhere",
  },
  {
    // A functional index rather than a generated column: Directus would
    // see a `daterange` column as a type it cannot render, and a push
    // could not recreate it. The expression is invisible to Directus and
    // any query that uses the same expression uses the index. NULL bounds
    // are unbounded, which is what `before` and `after` mean.
    name: "events_daterange",
    definition: `CREATE INDEX IF NOT EXISTS events_daterange
                   ON events USING gist (daterange(date_earliest, date_latest, '[]'))`,
    because: "\"everyone alive in 1881\" is a range query",
  },
  {
    // Of several events of one type on one subject, at most one is the
    // conclusion. The partial index is the whole Genealogical Proof
    // Standard in one line: keep every assertion, mark one.
    name: "events_one_conclusion_per_person",
    definition: `CREATE UNIQUE INDEX IF NOT EXISTS events_one_conclusion_per_person
                   ON events (subject_person, type) WHERE is_conclusion AND subject_person IS NOT NULL`,
    because: "one conclusion per fact per person; every other assertion kept",
  },
  {
    name: "events_one_conclusion_per_couple",
    definition: `CREATE UNIQUE INDEX IF NOT EXISTS events_one_conclusion_per_couple
                   ON events (subject_couple, type) WHERE is_conclusion AND subject_couple IS NOT NULL`,
    because: "and per couple",
  },
  {
    name: "event_participants_person",
    definition: `CREATE INDEX IF NOT EXISTS event_participants_person ON event_participants (person)`,
    because: "every event a person appears in",
  },
  {
    // NULLS NOT DISTINCT: two global rows (tree NULL) with the same code
    // would otherwise both be allowed, because SQL's NULLs are unequal.
    name: "event_types_code",
    definition: `CREATE UNIQUE INDEX IF NOT EXISTS event_types_code ON event_types (tree, code) NULLS NOT DISTINCT`,
    because: "one code per vocabulary, global or per tree",
  },
  {
    name: "places_parent",
    definition: `CREATE INDEX IF NOT EXISTS places_parent ON places (parent_place)`,
    because: "the hierarchy walk",
  },
  {
    name: "places_tree_type",
    definition: `CREATE INDEX IF NOT EXISTS places_tree_type ON places (tree, type, has_public_reference)`,
    because: "the public filter on places",
  },
  {
    name: "places_name_trgm",
    definition: `CREATE INDEX IF NOT EXISTS places_name_trgm ON places USING gin (stemma_norm(name) gin_trgm_ops)`,
    because: "Gdańsk, Gdansk, Danzig",
  },
  {
    name: "place_names_place",
    definition: `CREATE INDEX IF NOT EXISTS place_names_place ON place_names (place, valid_from)`,
    because: "the name valid at a date",
  },
  {
    name: "citation_links_target",
    definition: `CREATE INDEX IF NOT EXISTS citation_links_target ON citation_links (collection, item)`,
    because: "the citations behind a fact",
  },
  {
    name: "media_links_target",
    definition: `CREATE INDEX IF NOT EXISTS media_links_target ON media_links (collection, item)`,
    because: "the pictures of a thing",
  },
  {
    name: "media_subjects_person",
    definition: `CREATE INDEX IF NOT EXISTS media_subjects_person ON media_subjects (person)`,
    because: "every photograph a person is in",
  },
  {
    name: "media_file",
    definition: `CREATE INDEX IF NOT EXISTS media_file ON media (file)`,
    because: "the file's tree is copied from here",
  },
  {
    name: "tree_invitations_pending",
    definition: `CREATE UNIQUE INDEX IF NOT EXISTS tree_invitations_pending
                   ON tree_invitations (tree, lower(email)) WHERE status = 'pending'`,
    because: "one open invitation per address per tree",
  },
];

/* ── functions and triggers ───────────────────────────────────────────── */

/**
 * `unaccent()` is STABLE, not IMMUTABLE, so it cannot sit in an index
 * expression. Wrapping it with the dictionary named explicitly is the
 * standard way round, and `stemma_norm` is the one form every search
 * compares against.
 */
const NORMALISE = `
CREATE OR REPLACE FUNCTION stemma_unaccent(text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$ SELECT public.unaccent('public.unaccent', $1) $$;

CREATE OR REPLACE FUNCTION stemma_norm(text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT lower(stemma_unaccent(coalesce($1, ''))) $$;
`;

/**
 * No person may be their own ancestor — through descent.
 *
 * Adding parent → child closes a loop exactly when `child` is already an
 * ancestor of `parent`, so the walk starts at the proposed parent and
 * climbs. Only descent lineages are walked: birth, adoption, donor,
 * surrogate cannot loop. Step, foster and guardian can — a man who marries
 * a widow while his father marries her daughter is, through step edges,
 * his own grandfather, and that is a family, not an error.
 *
 * `UNION` rather than `UNION ALL`, recursive term selecting only the id:
 * the walk terminates even over data that already contains a cycle, so
 * the guard cannot be wedged by the situation it exists to prevent. That
 * was demonstrated, not argued — see the race below.
 *
 * The advisory lock is the fix for that race. Under READ COMMITTED two
 * sessions inserting A→B and B→A each saw no cycle and both committed.
 * Locking on the tree serialises edge writes within a tree and lets every
 * other tree proceed.
 */
const ANCESTRY_ACYCLIC = `
CREATE OR REPLACE FUNCTION stemma_parentage_acyclic() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  loops boolean;
  who   text;
BEGIN
  IF NEW.parent = NEW.child THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = 'A person cannot be their own parent.';
  END IF;

  IF NEW.lineage NOT IN (${sqlList(DESCENT_LINEAGES)}) THEN
    RETURN NEW;   -- affinity, not descent: may loop, legally
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(NEW.tree::text));

  WITH RECURSIVE ancestors(id) AS (
    SELECT NEW.parent
    UNION
    SELECT p.parent FROM parentage p JOIN ancestors a ON p.child = a.id
     WHERE p.lineage IN (${sqlList(DESCENT_LINEAGES)})
  )
  SELECT EXISTS (SELECT 1 FROM ancestors WHERE id = NEW.child) INTO loops;

  IF loops THEN
    SELECT coalesce(display_name, 'that person') INTO who FROM persons WHERE id = NEW.child;
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = format(
        'This would make %s their own ancestor. A family tree is a directed acyclic '
        'graph: the same person may appear in two places on one chart (pedigree '
        'collapse — normal), but a line of descent cannot return to where it started. '
        'Check whether the parent and child are the right way round.', who);
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS stemma_parentage_acyclic ON parentage;
CREATE TRIGGER stemma_parentage_acyclic
  BEFORE INSERT OR UPDATE ON parentage
  FOR EACH ROW EXECUTE FUNCTION stemma_parentage_acyclic();
`;

/** Same rule, simpler graph: a place is not inside itself, however far up. */
const PLACE_ACYCLIC = `
CREATE OR REPLACE FUNCTION stemma_place_acyclic() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE loops boolean;
BEGIN
  IF NEW.parent_place IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(NEW.tree::text));
  WITH RECURSIVE up(id) AS (
    SELECT NEW.parent_place
    UNION
    SELECT p.parent_place FROM places p JOIN up ON p.id = up.id WHERE p.parent_place IS NOT NULL
  )
  SELECT EXISTS (SELECT 1 FROM up WHERE id = NEW.id) INTO loops;
  IF loops THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = 'This would put a place inside itself. Check the parent.';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS stemma_place_acyclic ON places;
CREATE TRIGGER stemma_place_acyclic
  BEFORE INSERT OR UPDATE OF parent_place ON places
  FOR EACH ROW EXECUTE FUNCTION stemma_place_acyclic();
`;

/**
 * A row's tree must agree with every row it points at.
 *
 * `tree` is denormalised onto every collection so the public filter is
 * one hop. That buys a flat, indexable security filter and costs exactly
 * this: the column can disagree with the truth — and a parentage row
 * stamped with a public tree whose people are in somebody's private one
 * would be served to strangers by a filter working exactly as designed.
 *
 * One function, one arm per table, one helper that fetches the target's
 * tree by name so the many-to-any junctions are checked too. An event
 * type may be global (tree NULL) and is then fine for any tree.
 */
const TREE_CONSISTENCY = `
CREATE OR REPLACE FUNCTION stemma_assert_tree(row_tree uuid, target_table text, target uuid, label text, allow_global boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE target_tree uuid; found_it boolean;
BEGIN
  IF target IS NULL THEN RETURN; END IF;
  EXECUTE format('SELECT tree FROM %I WHERE id = $1', target_table) INTO target_tree USING target;
  GET DIAGNOSTICS found_it = ROW_COUNT;
  IF NOT found_it THEN RETURN; END IF;                 -- the foreign key will say so
  IF target_tree IS NULL AND allow_global THEN RETURN; END IF;
  IF target_tree IS DISTINCT FROM row_tree THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = format(
        'This row says it belongs to one tree but %s belongs to another. Stemma does not '
        'link rows across trees — two users recording the same ancestor have two separate '
        'people, by design. The tree column is what the public access filter reads, so '
        'it is not allowed to disagree with the rows it points at.', label);
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION stemma_tree_agrees() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'person_names' THEN
      PERFORM stemma_assert_tree(NEW.tree, 'persons', NEW.person, 'the person');
      PERFORM stemma_assert_tree(NEW.tree, 'events', NEW.event, 'the event');
    WHEN 'parentage' THEN
      PERFORM stemma_assert_tree(NEW.tree, 'persons', NEW.parent, 'the parent');
      PERFORM stemma_assert_tree(NEW.tree, 'persons', NEW.child, 'the child');
      PERFORM stemma_assert_tree(NEW.tree, 'events', NEW.event, 'the event');
    WHEN 'couples' THEN
      PERFORM stemma_assert_tree(NEW.tree, 'persons', NEW.person_a, 'one partner');
      PERFORM stemma_assert_tree(NEW.tree, 'persons', NEW.person_b, 'one partner');
    WHEN 'associations' THEN
      PERFORM stemma_assert_tree(NEW.tree, 'persons', NEW.person_a, 'one person');
      PERFORM stemma_assert_tree(NEW.tree, 'persons', NEW.person_b, 'the other person');
    WHEN 'events' THEN
      PERFORM stemma_assert_tree(NEW.tree, 'persons', NEW.subject_person, 'the subject');
      PERFORM stemma_assert_tree(NEW.tree, 'couples', NEW.subject_couple, 'the couple');
      PERFORM stemma_assert_tree(NEW.tree, 'places', NEW.place, 'the place');
      PERFORM stemma_assert_tree(NEW.tree, 'event_types', NEW.type, 'the event type', true);
    WHEN 'event_participants' THEN
      PERFORM stemma_assert_tree(NEW.tree, 'events', NEW.event, 'the event');
      PERFORM stemma_assert_tree(NEW.tree, 'persons', NEW.person, 'the participant');
    WHEN 'places' THEN
      PERFORM stemma_assert_tree(NEW.tree, 'places', NEW.parent_place, 'the parent place');
    WHEN 'place_names' THEN
      PERFORM stemma_assert_tree(NEW.tree, 'places', NEW.place, 'the place');
    WHEN 'sources' THEN
      PERFORM stemma_assert_tree(NEW.tree, 'repositories', NEW.repository, 'the repository');
    WHEN 'citations' THEN
      PERFORM stemma_assert_tree(NEW.tree, 'sources', NEW.source, 'the source');
    WHEN 'citation_links' THEN
      PERFORM stemma_assert_tree(NEW.tree, 'citations', NEW.citation, 'the citation');
      -- The CHECK constraint says the same thing, but a BEFORE trigger runs
      -- first and would otherwise fail on the dynamic SQL with a message
      -- about a missing column rather than about the mistake.
      IF NEW.collection NOT IN (${sqlList(CITABLE)}) THEN
        RAISE EXCEPTION USING ERRCODE = 'check_violation',
          MESSAGE = format('A citation cannot point at %s. It supports a person, a name, an edge, a couple, an event, an association or a place.', NEW.collection);
      END IF;
      PERFORM stemma_assert_tree(NEW.tree, NEW.collection, NEW.item::uuid, 'the cited row');
    WHEN 'media_subjects' THEN
      PERFORM stemma_assert_tree(NEW.tree, 'media', NEW.media, 'the media item');
      PERFORM stemma_assert_tree(NEW.tree, 'persons', NEW.person, 'the person');
    WHEN 'media_links' THEN
      PERFORM stemma_assert_tree(NEW.tree, 'media', NEW.media, 'the media item');
      IF NEW.collection NOT IN (${sqlList(ILLUSTRATABLE)}) THEN
        RAISE EXCEPTION USING ERRCODE = 'check_violation',
          MESSAGE = format('Media cannot be attached to %s.', NEW.collection);
      END IF;
      PERFORM stemma_assert_tree(NEW.tree, NEW.collection, NEW.item::uuid, 'the illustrated row');
    WHEN 'trees' THEN
      PERFORM stemma_assert_tree(NEW.id, 'persons', NEW.home_person, 'the home person');
    ELSE NULL;
  END CASE;
  RETURN NEW;
END;
$fn$;
` + [
  "person_names", "parentage", "couples", "associations", "events", "event_participants",
  "places", "place_names", "sources", "citations", "citation_links", "media_subjects", "media_links", "trees",
].map((t) => `
DROP TRIGGER IF EXISTS stemma_tree_agrees ON ${t};
CREATE TRIGGER stemma_tree_agrees BEFORE INSERT OR UPDATE ON ${t}
  FOR EACH ROW EXECUTE FUNCTION stemma_tree_agrees();`).join("\n");

/**
 * A person stays in the tree they were made in.
 *
 * Moving one would leave every edge and name stamped with the old tree,
 * and the public filter reads the stamp. Cross-tree movement is
 * cross-tree matching wearing a hat — not a feature — so it is refused
 * rather than cascaded. A person nothing references yet may move.
 */
const PERSON_TREE_FROZEN = `
CREATE OR REPLACE FUNCTION stemma_person_tree_frozen() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.tree = OLD.tree THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM person_names WHERE person = OLD.id)
     OR EXISTS (SELECT 1 FROM parentage WHERE parent = OLD.id OR child = OLD.id)
     OR EXISTS (SELECT 1 FROM couples WHERE person_a = OLD.id OR person_b = OLD.id)
     OR EXISTS (SELECT 1 FROM events WHERE subject_person = OLD.id)
     OR EXISTS (SELECT 1 FROM event_participants WHERE person = OLD.id)
     OR EXISTS (SELECT 1 FROM associations WHERE person_a = OLD.id OR person_b = OLD.id)
     OR EXISTS (SELECT 1 FROM media_subjects WHERE person = OLD.id) THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = 'A person with names, edges or events cannot be moved to another tree — '
                'every row about them carries the tree they are in. Stemma does not link '
                'or move people across trees.';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS stemma_person_tree_frozen ON persons;
CREATE TRIGGER stemma_person_tree_frozen BEFORE UPDATE OF tree ON persons
  FOR EACH ROW EXECUTE FUNCTION stemma_person_tree_frozen();
`;

/**
 * Nothing that took research to create is destroyed by accident.
 *
 * A DELETE on a person with edges is refused until the edges are removed
 * deliberately. `pg_trigger_depth() > 1` is a delete arriving through a
 * foreign-key cascade — the whole tree going — and that is allowed: the
 * deliberate act already happened one level up.
 */
const PREVENT_DELETE = `
CREATE OR REPLACE FUNCTION stemma_person_prevent_delete() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE edges int; unions int;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
  SELECT count(*) INTO edges FROM parentage WHERE parent = OLD.id OR child = OLD.id;
  SELECT count(*) INTO unions FROM couples WHERE person_a = OLD.id OR person_b = OLD.id;
  IF edges + unions > 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = format(
        '%s is connected to %s parent/child edge(s) and %s union(s). Remove those first — '
        'deleting a connected person silently reshapes the graph for everyone who descends '
        'from them.', coalesce(OLD.display_name, 'This person'), edges, unions);
  END IF;
  RETURN OLD;
END;
$fn$;

DROP TRIGGER IF EXISTS stemma_person_prevent_delete ON persons;
CREATE TRIGGER stemma_person_prevent_delete BEFORE DELETE ON persons
  FOR EACH ROW EXECUTE FUNCTION stemma_person_prevent_delete();
`;

/**
 * The shown name and the sort name, maintained from the name list.
 *
 * Caches, not second sources of truth. The lowest sort_order wins. The
 * name's own order (or the tree's default) decides given-first or
 * surname-first; the tree's particle convention decides whether
 * "van Gogh" sorts under G or V. A person with no names keeps NULLs —
 * the unnamed infant in a burial register is real, and writing "Unknown"
 * would assert something the sources do not.
 *
 * Recomputed for every person in a tree when the tree's conventions
 * change — rare, and the alternative is a tree whose lists disagree with
 * its settings.
 */
const DISPLAY_NAME = `
CREATE OR REPLACE FUNCTION stemma_compute_names(subject uuid) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE
  n record; t record;
  ord text; shown text; sorted text; given_part text;
BEGIN
  SELECT * INTO t FROM trees WHERE id = (SELECT tree FROM persons WHERE id = subject);
  SELECT * INTO n FROM person_names WHERE person = subject
   ORDER BY sort_order NULLS LAST, date_created NULLS LAST, id LIMIT 1;

  IF n IS NULL THEN
    UPDATE persons SET display_name = NULL, sort_name = NULL WHERE id = subject;
    RETURN;
  END IF;

  ord := coalesce(n.name_order, t.default_name_order, 'given_first');
  given_part := nullif(btrim(concat_ws(' ', n.given, n.patronymic)), '');

  IF ord = 'surname_first' THEN
    shown := concat_ws(' ', n.particle, n.surname, given_part);
  ELSE
    shown := concat_ws(' ', given_part, n.particle, n.surname);
  END IF;

  IF n.surname IS NULL OR btrim(n.surname) = '' THEN
    sorted := given_part;
  ELSIF coalesce(t.particle_sorting, 'ignore') = 'include' THEN
    sorted := concat_ws(', ', concat_ws(' ', n.particle, n.surname), given_part);
  ELSE
    sorted := concat_ws(', ', n.surname, concat_ws(' ', given_part, n.particle));
  END IF;

  UPDATE persons SET display_name = nullif(btrim(shown), ''), sort_name = nullif(btrim(sorted), '')
   WHERE id = subject;
END;
$fn$;

CREATE OR REPLACE FUNCTION stemma_person_display_name() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM stemma_compute_names(CASE WHEN TG_OP = 'DELETE' THEN OLD.person ELSE NEW.person END);
  IF TG_OP = 'UPDATE' AND NEW.person <> OLD.person THEN PERFORM stemma_compute_names(OLD.person); END IF;
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS stemma_person_display_name ON person_names;
CREATE TRIGGER stemma_person_display_name
  AFTER INSERT OR UPDATE OR DELETE ON person_names
  FOR EACH ROW EXECUTE FUNCTION stemma_person_display_name();

CREATE OR REPLACE FUNCTION stemma_tree_conventions_changed() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE p uuid;
BEGIN
  IF NEW.default_name_order IS NOT DISTINCT FROM OLD.default_name_order
     AND NEW.particle_sorting IS NOT DISTINCT FROM OLD.particle_sorting THEN RETURN NULL; END IF;
  FOR p IN SELECT id FROM persons WHERE tree = NEW.id LOOP PERFORM stemma_compute_names(p); END LOOP;
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS stemma_tree_conventions_changed ON trees;
CREATE TRIGGER stemma_tree_conventions_changed AFTER UPDATE OF default_name_order, particle_sorting ON trees
  FOR EACH ROW EXECUTE FUNCTION stemma_tree_conventions_changed();
`;

/**
 * A short, stable, non-sequential public id per person.
 *
 * Eight characters of Crockford's base32 — no I, L, O, U, so it survives
 * being read aloud — unique within the tree. Generated once; refusing a
 * change afterwards, because a public URL is a promise.
 */
const PUBLIC_ID = `
CREATE OR REPLACE FUNCTION stemma_person_public_id() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  alphabet constant text := '0123456789abcdefghjkmnpqrstvwxyz';
  candidate text; i int;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.public_id IS NOT NULL AND NEW.public_id IS DISTINCT FROM OLD.public_id THEN
    IF NEW.public_id IS NULL THEN
      NEW.public_id := OLD.public_id;        -- clearing it is not a request to regenerate
      RETURN NEW;
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = 'A person''s public id does not change: it is in URLs people have shared.';
  END IF;
  IF NEW.public_id IS NOT NULL THEN RETURN NEW; END IF;

  LOOP
    candidate := '';
    FOR i IN 1..8 LOOP
      candidate := candidate || substr(alphabet, 1 + floor(random() * 32)::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM persons WHERE tree = NEW.tree AND public_id = candidate);
  END LOOP;
  NEW.public_id := candidate;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS stemma_person_public_id ON persons;
CREATE TRIGGER stemma_person_public_id BEFORE INSERT OR UPDATE ON persons
  FOR EACH ROW EXECUTE FUNCTION stemma_person_public_id();
`;

/**
 * A tree always has an owner who can act.
 *
 * Genealogists die; the tree is what the family wants. Two ways to be an
 * owner (trees.owner and an owner-role membership) are kept in step:
 * setting trees.owner creates or upgrades the membership; the last
 * owner-role membership cannot be removed or demoted while the tree
 * exists; and if trees.owner is nulled (its user deleted), the
 * longest-standing remaining owner is promoted.
 */
const TREE_OWNER = `
CREATE OR REPLACE FUNCTION stemma_tree_owner_membership() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.owner IS NULL THEN RETURN NULL; END IF;
  INSERT INTO tree_members (id, tree, "user", role) VALUES (gen_random_uuid(), NEW.id, NEW.owner, 'owner')
  ON CONFLICT (tree, "user") DO UPDATE SET role = 'owner';
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS stemma_tree_owner_membership ON trees;
CREATE TRIGGER stemma_tree_owner_membership AFTER INSERT OR UPDATE OF owner ON trees
  FOR EACH ROW EXECUTE FUNCTION stemma_tree_owner_membership();

CREATE OR REPLACE FUNCTION stemma_tree_owner_promote() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.owner IS NOT NULL OR OLD.owner IS NULL THEN RETURN NEW; END IF;
  SELECT m."user" INTO NEW.owner FROM tree_members m
   WHERE m.tree = NEW.id AND m.role = 'owner' AND m."user" <> OLD.owner
   ORDER BY m.date_created NULLS LAST, m.id LIMIT 1;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS stemma_tree_owner_promote ON trees;
CREATE TRIGGER stemma_tree_owner_promote BEFORE UPDATE OF owner ON trees
  FOR EACH ROW EXECUTE FUNCTION stemma_tree_owner_promote();

CREATE OR REPLACE FUNCTION stemma_last_owner_stays() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF OLD.role <> 'owner' THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'UPDATE' AND NEW.role = 'owner' AND NEW.tree = OLD.tree THEN RETURN NEW; END IF;
  -- The tree itself going: its memberships go with it, and the deliberate
  -- act already happened one level up.
  IF NOT EXISTS (SELECT 1 FROM trees WHERE id = OLD.tree) THEN RETURN COALESCE(NEW, OLD); END IF;
  IF NOT EXISTS (SELECT 1 FROM tree_members WHERE tree = OLD.tree AND role = 'owner' AND id <> OLD.id) THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = 'This is the tree''s only owner. Make somebody else an owner first — a tree '
                'with nobody who can administer it is a tree nobody can ever hand on.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$fn$;

DROP TRIGGER IF EXISTS stemma_last_owner_stays ON tree_members;
CREATE TRIGGER stemma_last_owner_stays BEFORE UPDATE OF role, tree OR DELETE ON tree_members
  FOR EACH ROW EXECUTE FUNCTION stemma_last_owner_stays();
`;

/**
 * Publishing is remembered, and freezes the slug.
 *
 * `first_published_at` is set the first time is_public goes on and never
 * cleared. After that the slug cannot change: it is in URLs people have
 * emailed to relatives.
 */
const TREE_PUBLISHED = `
CREATE OR REPLACE FUNCTION stemma_tree_published() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.is_public AND NEW.first_published_at IS NULL THEN NEW.first_published_at := now(); END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.first_published_at IS NOT NULL THEN NEW.first_published_at := OLD.first_published_at; END IF;
    IF OLD.first_published_at IS NOT NULL AND NEW.slug <> OLD.slug THEN
      RAISE EXCEPTION USING ERRCODE = 'check_violation',
        MESSAGE = 'This tree has been public; its slug is in links people have shared and cannot change.';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS stemma_tree_published ON trees;
CREATE TRIGGER stemma_tree_published BEFORE INSERT OR UPDATE ON trees
  FOR EACH ROW EXECUTE FUNCTION stemma_tree_published();
`;

/** The invitation link's secret, made by the database so no client has to. */
const INVITATION_TOKEN = `
CREATE OR REPLACE FUNCTION stemma_invitation_token() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.token IS NULL THEN NEW.token := encode(gen_random_bytes(24), 'hex'); END IF;
  IF NEW.expires_at IS NULL THEN NEW.expires_at := now() + interval '14 days'; END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS stemma_invitation_token ON tree_invitations;
CREATE TRIGGER stemma_invitation_token BEFORE INSERT ON tree_invitations
  FOR EACH ROW EXECUTE FUNCTION stemma_invitation_token();
`;

/**
 * Visibility, computed into booleans.
 *
 * One function per boolean, each answering a join once and writing the
 * answer down; one fan-out from a person whose living or restricted flag
 * changed, touching every row that names them. The access policy then
 * compares columns.
 *
 *   events.has_living_participant   any participant living or restricted
 *   places.has_public_reference     any event here whose subject is public
 *   citation_links.is_public_ok     the cited row is itself public
 *   directus_files.is_public_ok     publishable, licensed, nobody in it hidden
 */
const VISIBILITY = `
CREATE OR REPLACE FUNCTION stemma_person_hidden(p uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT is_living OR is_restricted FROM persons WHERE id = p), true)
$$;

CREATE OR REPLACE FUNCTION stemma_event_visibility(e uuid) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE pl uuid;
BEGIN
  UPDATE events SET has_living_participant = EXISTS (
    SELECT 1 FROM event_participants ep JOIN persons p ON p.id = ep.person
     WHERE ep.event = e AND (p.is_living OR p.is_restricted))
   WHERE id = e RETURNING place INTO pl;
  IF pl IS NOT NULL THEN PERFORM stemma_place_visibility(pl); END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION stemma_event_is_public(e uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM events ev
      LEFT JOIN couples c ON c.id = ev.subject_couple
     WHERE ev.id = e AND NOT ev.is_restricted AND NOT ev.has_living_participant
       AND CASE WHEN ev.subject_person IS NOT NULL THEN NOT stemma_person_hidden(ev.subject_person)
                ELSE NOT stemma_person_hidden(c.person_a) AND NOT stemma_person_hidden(c.person_b) END)
$$;

CREATE OR REPLACE FUNCTION stemma_place_visibility(pl uuid) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE places SET has_public_reference = EXISTS (
    SELECT 1 FROM events ev WHERE ev.place = pl AND stemma_event_is_public(ev.id))
   WHERE id = pl;
END;
$fn$;

CREATE OR REPLACE FUNCTION stemma_row_is_public(coll text, item uuid) RETURNS boolean
LANGUAGE plpgsql STABLE AS $fn$
DECLARE ok boolean := false;
BEGIN
  CASE coll
    WHEN 'persons' THEN ok := NOT stemma_person_hidden(item);
    WHEN 'person_names' THEN SELECT NOT stemma_person_hidden(person) INTO ok FROM person_names WHERE id = item;
    WHEN 'parentage' THEN SELECT NOT is_restricted AND NOT stemma_person_hidden(parent) AND NOT stemma_person_hidden(child) INTO ok FROM parentage WHERE id = item;
    WHEN 'couples' THEN SELECT NOT is_restricted AND NOT stemma_person_hidden(person_a) AND NOT stemma_person_hidden(person_b) INTO ok FROM couples WHERE id = item;
    WHEN 'associations' THEN SELECT NOT is_restricted AND NOT stemma_person_hidden(person_a) AND NOT stemma_person_hidden(person_b) INTO ok FROM associations WHERE id = item;
    WHEN 'events' THEN ok := stemma_event_is_public(item);
    WHEN 'places' THEN SELECT has_public_reference AND type <> 'address' INTO ok FROM places WHERE id = item;
    WHEN 'sources' THEN ok := true;
    WHEN 'citations' THEN ok := true;
    ELSE ok := false;
  END CASE;
  RETURN coalesce(ok, false);
END;
$fn$;

CREATE OR REPLACE FUNCTION stemma_link_visibility(l uuid) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE citation_links SET is_public_ok = stemma_row_is_public(collection, item::uuid) WHERE id = l;
END;
$fn$;

CREATE OR REPLACE FUNCTION stemma_media_visibility(m uuid) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE f uuid; ok boolean; t uuid;
BEGIN
  SELECT file, tree,
         publishable AND NOT is_restricted
         AND licence IN ('cc_by', 'cc_by_sa', 'cc_by_nc', 'cc0', 'public_domain')
         AND NOT EXISTS (SELECT 1 FROM media_subjects ms WHERE ms.media = m AND stemma_person_hidden(ms.person))
    INTO f, t, ok FROM media WHERE id = m;
  IF f IS NULL THEN RETURN; END IF;
  UPDATE directus_files SET tree = t, is_public_ok = coalesce(ok, false) WHERE id = f;
END;
$fn$;

-- The fan-out: a person's flags changed, so every boolean that depends on them.
CREATE OR REPLACE FUNCTION stemma_person_visibility_changed(p uuid) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE e uuid; l uuid; m uuid; pl uuid;
BEGIN
  FOR e IN SELECT id FROM events WHERE subject_person = p
           UNION SELECT event FROM event_participants WHERE person = p
           UNION SELECT ev.id FROM events ev JOIN couples c ON c.id = ev.subject_couple WHERE c.person_a = p OR c.person_b = p
  LOOP PERFORM stemma_event_visibility(e); END LOOP;
  FOR pl IN SELECT DISTINCT place FROM events WHERE place IS NOT NULL AND subject_person = p
  LOOP PERFORM stemma_place_visibility(pl); END LOOP;
  FOR l IN SELECT cl.id FROM citation_links cl
            WHERE (cl.collection = 'persons' AND cl.item = p::text)
               OR (cl.collection = 'person_names' AND cl.item IN (SELECT id::text FROM person_names WHERE person = p))
               OR (cl.collection = 'parentage' AND cl.item IN (SELECT id::text FROM parentage WHERE parent = p OR child = p))
               OR (cl.collection = 'couples' AND cl.item IN (SELECT id::text FROM couples WHERE person_a = p OR person_b = p))
               OR (cl.collection = 'associations' AND cl.item IN (SELECT id::text FROM associations WHERE person_a = p OR person_b = p))
               OR (cl.collection = 'events' AND cl.item IN (SELECT id::text FROM events WHERE subject_person = p
                                                              UNION SELECT event::text FROM event_participants WHERE person = p))
  LOOP PERFORM stemma_link_visibility(l); END LOOP;
  FOR m IN SELECT media FROM media_subjects WHERE person = p LOOP PERFORM stemma_media_visibility(m); END LOOP;
END;
$fn$;

CREATE OR REPLACE FUNCTION stemma_person_flags_trigger() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.is_living IS DISTINCT FROM OLD.is_living OR NEW.is_restricted IS DISTINCT FROM OLD.is_restricted THEN
    PERFORM stemma_person_visibility_changed(NEW.id);
  END IF;
  RETURN NULL;
END;
$fn$;
DROP TRIGGER IF EXISTS stemma_person_flags ON persons;
CREATE TRIGGER stemma_person_flags AFTER UPDATE OF is_living, is_restricted ON persons
  FOR EACH ROW EXECUTE FUNCTION stemma_person_flags_trigger();

CREATE OR REPLACE FUNCTION stemma_participants_trigger() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM stemma_event_visibility(CASE WHEN TG_OP = 'DELETE' THEN OLD.event ELSE NEW.event END);
  IF TG_OP = 'UPDATE' AND NEW.event <> OLD.event THEN PERFORM stemma_event_visibility(OLD.event); END IF;
  RETURN NULL;
END;
$fn$;
DROP TRIGGER IF EXISTS stemma_participants_visibility ON event_participants;
CREATE TRIGGER stemma_participants_visibility AFTER INSERT OR UPDATE OR DELETE ON event_participants
  FOR EACH ROW EXECUTE FUNCTION stemma_participants_trigger();

CREATE OR REPLACE FUNCTION stemma_events_trigger() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.place IS NOT NULL THEN PERFORM stemma_place_visibility(OLD.place); END IF;
    RETURN NULL;
  END IF;
  -- Recompute this event's own flag (subject or restriction may have
  -- changed), then the places on both sides of a move.
  PERFORM stemma_event_visibility(NEW.id);
  IF TG_OP = 'UPDATE' AND OLD.place IS DISTINCT FROM NEW.place AND OLD.place IS NOT NULL THEN
    PERFORM stemma_place_visibility(OLD.place);
  END IF;
  RETURN NULL;
END;
$fn$;
-- Column-specific on purpose: the visibility function writes
-- has_living_participant back to this table, and an unqualified AFTER
-- UPDATE would fire on that write and recurse until the stack ran out.
-- It did. Listing the columns that *change* visibility is the fix.
DROP TRIGGER IF EXISTS stemma_events_visibility ON events;
CREATE TRIGGER stemma_events_visibility
  AFTER INSERT OR UPDATE OF type, subject_person, subject_couple, place, is_restricted OR DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION stemma_events_trigger();

CREATE OR REPLACE FUNCTION stemma_links_trigger() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN PERFORM stemma_link_visibility(NEW.id); RETURN NULL; END;
$fn$;
DROP TRIGGER IF EXISTS stemma_links_visibility ON citation_links;
CREATE TRIGGER stemma_links_visibility AFTER INSERT OR UPDATE OF citation, collection, item ON citation_links
  FOR EACH ROW EXECUTE FUNCTION stemma_links_trigger();

-- Two functions, not one with a CASE.
--
-- plpgsql resolves a field reference when it first parses the statement,
-- not when the branch is taken, so OLD.media inside a CASE arm that never
-- runs on the media table still fails with: record "old" has no field
-- "media" — on every insert. One function per table shape is both correct
-- and shorter to read.
--
-- (No backticks in these comments: the whole block is a TypeScript
-- template literal, and a stray backtick ends the string mid-SQL.)
CREATE OR REPLACE FUNCTION stemma_media_row_trigger() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM stemma_media_visibility(NEW.id);
  RETURN NULL;
END;
$fn$;

CREATE OR REPLACE FUNCTION stemma_media_subject_trigger() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM stemma_media_visibility(CASE WHEN TG_OP = 'DELETE' THEN OLD.media ELSE NEW.media END);
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS stemma_media_visibility ON media;
CREATE TRIGGER stemma_media_visibility
  AFTER INSERT OR UPDATE OF file, publishable, licence, is_restricted, tree ON media
  FOR EACH ROW EXECUTE FUNCTION stemma_media_row_trigger();
DROP TRIGGER IF EXISTS stemma_media_subjects_visibility ON media_subjects;
CREATE TRIGGER stemma_media_subjects_visibility AFTER INSERT OR UPDATE OR DELETE ON media_subjects
  FOR EACH ROW EXECUTE FUNCTION stemma_media_subject_trigger();
`;

/**
 * A death ends a life.
 *
 * An event whose type `ends_life` — death, burial, cremation, a tree's own
 * "funeral" — switches the subject's is_living off and records why.
 * Deleting the event does not switch it back on: that is a review, not
 * an inference, and a person does not become alive because a record was
 * mis-filed.
 */
const ENDS_LIFE = `
CREATE OR REPLACE FUNCTION stemma_event_ends_life() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.subject_person IS NULL THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM event_types WHERE id = NEW.type AND ends_life) THEN
    UPDATE persons SET is_living = false, living_basis = 'death_record'
     WHERE id = NEW.subject_person AND (is_living OR living_basis <> 'death_record');
  END IF;
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS stemma_event_ends_life ON events;
CREATE TRIGGER stemma_event_ends_life AFTER INSERT OR UPDATE OF type, subject_person ON events
  FOR EACH ROW EXECUTE FUNCTION stemma_event_ends_life();
`;


/**
 * Who may add a row to a tree.
 *
 * Directus cannot say. Its `permissions` filter is ignored on create —
 * there is no row to filter — and its `validation` is a flat check on the
 * payload, so "the writer is a member of this tree at contributor or
 * above" cannot be written there. It can be written here: Directus stamps
 * `user_created` before the insert, and the trigger reads it against
 * tree_members.
 *
 * Exemptions, each deliberate: a row with no `user_created` came from a
 * direct database connection, which is already trusted; a writer holding
 * an admin policy may do anything; a tree may be created by anyone signed
 * in, because the owner trigger then makes them its owner; a global event
 * type (tree NULL) is admin-only, and the policy's `_submitted` check
 * catches that before this does.
 *
 * The required standing is the trigger's argument, so membership rows and
 * invitations demand an owner where everything else accepts a contributor.
 */
const WRITER_IS_MEMBER = `
CREATE OR REPLACE FUNCTION stemma_writer_is_member() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  u uuid := NEW.user_created;
  needed text[] := string_to_array(TG_ARGV[0], ',');
  standing text;
BEGIN
  IF u IS NULL THEN RETURN NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM directus_access a JOIN directus_policies p ON p.id = a.policy
     WHERE p.admin_access
       AND (a."user" = u OR a.role = (SELECT role FROM directus_users WHERE id = u))
  ) THEN RETURN NEW; END IF;

  IF TG_TABLE_NAME = 'event_types' AND NEW.tree IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'insufficient_privilege',
      MESSAGE = 'Global event types are maintained by administrators. Set a tree to add one of your own.';
  END IF;

  SELECT m.role INTO standing FROM tree_members m WHERE m.tree = NEW.tree AND m."user" = u;
  IF standing IS NULL OR NOT (standing = ANY (needed)) THEN
    RAISE EXCEPTION USING ERRCODE = 'insufficient_privilege',
      MESSAGE = format('Adding to this tree needs %s standing; you %s.',
        array_to_string(needed, ' or '),
        CASE WHEN standing IS NULL THEN 'are not a member' ELSE 'are a ' || standing END);
  END IF;
  RETURN NEW;
END;
$fn$;
` + [
  ...["persons", "person_names", "couples", "parentage", "associations", "events", "event_participants",
      "places", "place_names", "repositories", "sources", "citations", "citation_links",
      "media", "media_subjects", "media_links"].map((t) => [t, "owner,editor,contributor"]),
  ["event_types", "owner,editor"],
  ["tree_members", "owner"],
  ["tree_invitations", "owner"],
].map(([t, roles]) => `
DROP TRIGGER IF EXISTS stemma_writer_is_member ON ${t};
CREATE TRIGGER stemma_writer_is_member BEFORE INSERT ON ${t}
  FOR EACH ROW EXECUTE FUNCTION stemma_writer_is_member('${roles}');`).join("\n");


/**
 * Plausibility, as a report — never as a constraint.
 *
 * A mother recorded as nine years old is implausible, and the parish
 * register really does say it: the row is kept and listed here. A
 * constraint on the unlikely deletes evidence; a view on it invites a
 * second look. One row per issue, with the item to open. Not a Directus
 * collection — a SQL view for the admin's reports and the website's
 * research page; surfacing it in the Data Studio is a later step.
 */
const DATA_ISSUES = `
CREATE OR REPLACE VIEW data_issues AS
WITH birth AS (
  SELECT e.subject_person AS person, e.date_earliest AS earliest, e.date_latest AS latest
    FROM events e JOIN event_types t ON t.id = e.type
   WHERE t.code = 'birth' AND e.is_conclusion AND e.subject_person IS NOT NULL
), death AS (
  SELECT e.subject_person AS person, e.date_earliest AS earliest, e.date_latest AS latest
    FROM events e JOIN event_types t ON t.id = e.type
   WHERE t.code = 'death' AND e.is_conclusion AND e.subject_person IS NOT NULL
)
-- A parent younger than twelve or a mother past fifty-five at a birth.
SELECT p.tree, 'parent_age' AS kind, 'warning' AS severity, 'parentage' AS collection, p.id::text AS item,
       format('%s was %s at the birth of %s', par.display_name,
              extract(year FROM age(bc.earliest, bp.latest))::int, ch.display_name) AS detail
  FROM parentage p
  JOIN persons par ON par.id = p.parent JOIN persons ch ON ch.id = p.child
  JOIN birth bp ON bp.person = p.parent JOIN birth bc ON bc.person = p.child
 WHERE p.lineage = 'birth'
   AND (bc.earliest < bp.latest + interval '12 years'
        OR (par.sex_recorded = 'female' AND bc.earliest > bp.earliest + interval '55 years')
        OR bc.earliest > bp.earliest + interval '90 years')
UNION ALL
-- A child born after a parent's death (ten months' grace for a father).
SELECT p.tree, 'born_after_parent_death', 'warning', 'parentage', p.id::text,
       format('%s was born after %s died', ch.display_name, par.display_name)
  FROM parentage p
  JOIN persons par ON par.id = p.parent JOIN persons ch ON ch.id = p.child
  JOIN death dp ON dp.person = p.parent JOIN birth bc ON bc.person = p.child
 WHERE p.lineage = 'birth'
   AND bc.earliest > dp.latest + CASE WHEN par.sex_recorded = 'female' THEN interval '0' ELSE interval '10 months' END
UNION ALL
-- Died before being born; lived past 110.
SELECT pe.tree, 'lifespan', 'warning', 'persons', pe.id::text,
       format('%s: born %s, died %s', pe.display_name, b.earliest, d.latest)
  FROM persons pe JOIN birth b ON b.person = pe.id JOIN death d ON d.person = pe.id
 WHERE d.latest < b.earliest OR d.earliest > b.latest + interval '110 years'
UNION ALL
-- More than two birth parents: legal in three jurisdictions, a duplicate everywhere else.
SELECT ch.tree, 'many_birth_parents', 'info', 'persons', ch.id::text,
       format('%s has %s birth parents on record', ch.display_name, count(*))
  FROM parentage p JOIN persons ch ON ch.id = p.child
 WHERE p.lineage = 'birth' AND p.status <> 'disproven'
 GROUP BY ch.tree, ch.id, ch.display_name HAVING count(*) > 2
UNION ALL
-- Partners who are also each other's ancestor or descendant. It happened; say so.
SELECT c.tree, 'partner_is_kin', 'info', 'couples', c.id::text,
       format('%s and %s are in a line of descent', a.display_name, b.display_name)
  FROM couples c JOIN persons a ON a.id = c.person_a JOIN persons b ON b.id = c.person_b
 WHERE EXISTS (
   WITH RECURSIVE up(id) AS (
     SELECT c.person_a UNION SELECT p.parent FROM parentage p JOIN up ON p.child = up.id WHERE p.lineage IN ('birth','adoptive'))
   SELECT 1 FROM up WHERE id = c.person_b)
    OR EXISTS (
   WITH RECURSIVE up(id) AS (
     SELECT c.person_b UNION SELECT p.parent FROM parentage p JOIN up ON p.child = up.id WHERE p.lineage IN ('birth','adoptive'))
   SELECT 1 FROM up WHERE id = c.person_a)
UNION ALL
-- Living, but born before the tree's cutoff and without a death: review.
SELECT pe.tree, 'presumed_dead', 'warning', 'persons', pe.id::text,
       format('%s is marked living but was born %s', pe.display_name, b.earliest)
  FROM persons pe JOIN trees t ON t.id = pe.tree JOIN birth b ON b.person = pe.id
 WHERE pe.is_living AND b.latest < now() - make_interval(years => t.living_cutoff_years)
UNION ALL
-- Siblings born within nine months and not marked as one birth.
SELECT a.tree, 'close_siblings', 'info', 'persons', a.child::text,
       format('%s and %s were born %s days apart', ca.display_name, cb.display_name, (bb.earliest - ba.earliest))
  FROM parentage a JOIN parentage b ON a.parent = b.parent AND a.child < b.child
  JOIN persons ca ON ca.id = a.child JOIN persons cb ON cb.id = b.child
  JOIN birth ba ON ba.person = a.child JOIN birth bb ON bb.person = b.child
 WHERE a.lineage = 'birth' AND b.lineage = 'birth'
   AND abs(bb.earliest - ba.earliest) BETWEEN 1 AND 270
   AND (ca.multiple_birth IS NULL OR ca.multiple_birth IS DISTINCT FROM cb.multiple_birth)
UNION ALL
-- A node nothing touches.
SELECT pe.tree, 'disconnected', 'info', 'persons', pe.id::text,
       format('%s has no names, edges or events', coalesce(pe.display_name, pe.id::text))
  FROM persons pe
 WHERE NOT EXISTS (SELECT 1 FROM parentage WHERE parent = pe.id OR child = pe.id)
   AND NOT EXISTS (SELECT 1 FROM couples WHERE person_a = pe.id OR person_b = pe.id)
   AND NOT EXISTS (SELECT 1 FROM events WHERE subject_person = pe.id)
   AND NOT EXISTS (SELECT 1 FROM person_names WHERE person = pe.id)
UNION ALL
-- A married name on somebody with no union on record.
SELECT n.tree, 'married_name_no_union', 'info', 'person_names', n.id::text,
       format('%s has a married name but no couple', pe.display_name)
  FROM person_names n JOIN persons pe ON pe.id = n.person
 WHERE n.type = 'married'
   AND NOT EXISTS (SELECT 1 FROM couples WHERE person_a = pe.id OR person_b = pe.id);
`;

const TRIGGERS: Array<{ sql: string; name: string; because: string }> = [
  { sql: NORMALISE, name: "stemma_norm", because: "one accent-stripped, lowercased form every search compares against" },
  { sql: ANCESTRY_ACYCLIC, name: "stemma_parentage_acyclic", because: "no person may be their own ancestor — through descent, under a lock" },
  { sql: PLACE_ACYCLIC, name: "stemma_place_acyclic", because: "a place is not inside itself" },
  { sql: TREE_CONSISTENCY, name: "stemma_tree_agrees", because: "a row's tree must agree with every row it points at, junctions included" },
  { sql: PERSON_TREE_FROZEN, name: "stemma_person_tree_frozen", because: "a connected person stays in their tree" },
  { sql: PREVENT_DELETE, name: "stemma_person_prevent_delete", because: "a connected person is detached before they are deleted" },
  { sql: DISPLAY_NAME, name: "stemma_person_display_name", because: "shown and sort names follow the name list, in the name's own order" },
  { sql: PUBLIC_ID, name: "stemma_person_public_id", because: "a short public id, made once, never changed" },
  { sql: TREE_OWNER, name: "stemma_tree_owner", because: "a tree always has an owner who can act" },
  { sql: TREE_PUBLISHED, name: "stemma_tree_published", because: "publishing is remembered and freezes the slug" },
  { sql: INVITATION_TOKEN, name: "stemma_invitation_token", because: "the invitation secret is made by the database" },
  { sql: VISIBILITY, name: "stemma_visibility", because: "the booleans the policy reads are computed here, never in the filter" },
  { sql: ENDS_LIFE, name: "stemma_event_ends_life", because: "a death ends a life; deleting the record does not undo it" },
  { sql: WRITER_IS_MEMBER, name: "stemma_writer_is_member", because: "who may add to a tree is decided here, because Directus cannot say it on create" },
  { sql: DATA_ISSUES, name: "data_issues (view)", because: "plausibility as a report, never a constraint" },
];

/**
 * Rows that exist from before a trigger did.
 *
 * `public_id` was added after nine persons existed; a no-op UPDATE runs
 * the BEFORE trigger, which fills the blanks. Each is a no-op on a fresh
 * database.
 */
const BACKFILLS: Array<{ sql: string; because: string }> = [
  { sql: `UPDATE persons SET public_id = NULL WHERE public_id IS NULL`, because: "public ids for persons made before the trigger" },
  { sql: `SELECT stemma_compute_names(id) FROM persons`, because: "sort names for persons made before the trigger" },
  { sql: `INSERT INTO tree_members (id, tree, "user", role) SELECT gen_random_uuid(), id, owner, 'owner' FROM trees WHERE owner IS NOT NULL
          ON CONFLICT (tree, "user") DO UPDATE SET role = 'owner'`, because: "owner memberships for trees made before the trigger" },
  { sql: `UPDATE trees SET first_published_at = coalesce(first_published_at, date_created, now()) WHERE is_public AND first_published_at IS NULL`,
    because: "publication dates for trees already public" },
];

/** Indexes superseded by a wider one. */
const RETIRED_INDEXES = ["persons_tree_living"];

/* ── applying it ─────────────────────────────────────────────────────── */

async function connect(): Promise<Client> {
  const client = new Client({ host: DB_HOST, port: DB_PORT, database: DB_DATABASE, user: DB_USER, password: DB_PASSWORD });
  await client.connect();
  return client;
}

async function constraintExists(client: Client, name: string): Promise<boolean> {
  const r = await client.query("SELECT 1 FROM pg_constraint WHERE conname = $1", [name]);
  return r.rowCount !== null && r.rowCount > 0;
}

/**
 * Applies the rules, and refuses rather than guesses.
 *
 * `ADD CONSTRAINT` over rows that already break it fails, correctly and
 * with a terrible message. So each is pre-flighted and the blocking rows
 * are printed. Nothing is deleted to make the DDL pass: quietly
 * discarding somebody's research to satisfy a migration is how a system
 * loses the argument about whether it can be trusted.
 */
export async function applyConstraints(): Promise<void> {
  let client: Client;
  try {
    client = await connect();
  } catch (e) {
    log.fail(`cannot reach Postgres at ${DB_HOST}:${DB_PORT} — ${e instanceof Error ? e.message : e}`);
    log.info("the database rules need a direct connection; `docker compose up -d` publishes one on loopback");
    return;
  }

  try {
    log.step("Extensions");
    for (const ext of ["pg_trgm", "unaccent", "pgcrypto"]) {
      await client.query(`CREATE EXTENSION IF NOT EXISTS ${ext}`);
      log.skip(ext);
    }

    // Directus generates uuids in application code; anything else that
    // writes — a migration, a psql fix-up, the import path — gets
    // `null value in column "id"` without this.
    log.step("Primary-key defaults");
    let defaulted = 0;
    for (const t of TABLES) {
      const r = await client.query(
        `SELECT column_default FROM information_schema.columns WHERE table_name = $1 AND column_name = 'id'`, [t]);
      if (r.rows[0]?.column_default) continue;
      await client.query(`ALTER TABLE ${t} ALTER COLUMN id SET DEFAULT gen_random_uuid()`);
      defaulted++;
    }
    if (defaulted) log.made(`${defaulted} table(s) given a uuid default`);
    else log.skip(`uuid defaults on ${TABLES.length} tables`);

    // Functions before constraints and indexes: the trigram indexes are
    // expressions over stemma_norm(), which has to exist first.
    log.step("Functions and triggers");
    for (const t of TRIGGERS) {
      try {
        await client.query(t.sql);
        log.made(`${t.name} — ${t.because}`);
      } catch (e) {
        log.fail(`${t.name}: ${e instanceof Error ? e.message : e}`);
      }
    }

    log.step("Constraints");
    for (const c of CONSTRAINTS) {
      if (await constraintExists(client, c.name)) { log.skip(c.name); continue; }
      let blocking: { rowCount: number | null; rows: Array<{ id: string; detail: string }> };
      try {
        blocking = await client.query<{ id: string; detail: string }>(c.offenders);
      } catch (e) {
        log.fail(`${c.name}: could not check for blocking rows — ${e instanceof Error ? e.message : e}`);
        continue;
      }
      if (blocking.rowCount) {
        log.fail(`${c.name}: ${blocking.rowCount} existing row(s) already break this rule`);
        for (const row of blocking.rows.slice(0, 8)) log.info(`    ${row.detail}`);
        if (blocking.rowCount > 8) log.info(`    …and ${blocking.rowCount - 8} more`);
        log.info("    nothing was deleted; resolve these and re-run");
        continue;
      }
      try {
        await client.query(`ALTER TABLE ${c.table} ADD CONSTRAINT ${c.name} ${c.definition}`);
        log.made(`${c.name} — ${c.because}`);
      } catch (e) {
        log.fail(`${c.name}: ${e instanceof Error ? e.message : e}`);
      }
    }

    log.step("Indexes");
    for (const name of RETIRED_INDEXES) {
      const r = await client.query(`DROP INDEX IF EXISTS ${name}`);
      if (r.command) log.skip(`retired ${name}`);
    }
    for (const idx of INDEXES) {
      try {
        await client.query(idx.definition);
        log.made(`${idx.name} — ${idx.because}`);
      } catch (e) {
        log.fail(`${idx.name}: ${e instanceof Error ? e.message : e}`);
      }
    }

    log.step("Backfills");
    for (const b of BACKFILLS) {
      try {
        const r = await client.query(b.sql);
        if (r.rowCount) log.made(`${r.rowCount} row(s) — ${b.because}`);
        else log.skip(b.because);
      } catch (e) {
        log.fail(`${b.because}: ${e instanceof Error ? e.message : e}`);
      }
    }
  } finally {
    await client.end();
  }
}

// Run directly: `pnpm rules`.
applyConstraints()
  .then(() => {
    const failed = log.failures();
    if (failed > 0) {
      log.warn(`${failed} rule${failed === 1 ? "" : "s"} did not apply — the guarantees they make do NOT hold`);
      process.exitCode = 1;
    } else {
      log.done("Database rules are in place");
    }
  })
  .catch((e) => {
    log.fail(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  });
