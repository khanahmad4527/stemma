/**
 * Every string an operator reads, keyed.
 *
 * Anywhere Directus accepts `$t:some_key` — a field note, a collection
 * note, a choice label, a validation message — it resolves from
 * `directus_translations`, which `d6s sync` carries. So the reasoning
 * recorded here reaches every environment the sync files are pushed to,
 * which matters more than usual for this project: a genealogy schema is
 * full of choices that look arbitrary until someone explains them.
 *
 * English only today. Doing it on day one is the point — retrofitting
 * `$t:` keys onto two hundred hard-coded notes is the chore that never
 * gets done.
 *
 * Choice labels are generated from the value lists the schema modules
 * export, with overrides where "Cc By" is not a label. One source for the
 * vocabulary; the label follows it.
 */
import { TREE_ROLES } from "./authoring/trees.js";
import {
  SEXES, LIVING_BASES, NAME_TYPES, NAME_ORDERS, LINEAGES, EDGE_STATUSES, ASSOCIATION_TYPES,
} from "./authoring/graph.js";
import { APPLIES_TO, EVENT_CATEGORIES, PARTICIPANT_ROLES } from "./authoring/events.js";
import { PLACE_TYPES, PRECISIONS } from "./authoring/places.js";
import { REPOSITORY_TYPES, SOURCE_TYPES, INFORMATION, EVIDENCE } from "./authoring/evidence.js";
import { MEDIA_KINDS, LICENCES } from "./authoring/media.js";
import { DATE_QUALIFIERS, CALENDARS } from "./authoring/_helpers.js";

const NOTES: Record<string, string> = {
  /* ---- nav folders ---------------------------------------------------- */
  // Six groups so the sidebar is six things rather than seventeen. Their
  // names live in `meta.translations` (see _theme.ts); these are the notes.
  stemma_folder_tenancy:
    "Who owns a tree and who may work on it. Membership is many-to-many — one person can belong to several trees at different levels — which is why it is a table rather than a column.",
  stemma_folder_graph:
    "People and the edges between them. A family tree is a directed acyclic graph, not a tree: cousins marry, and the same ancestor legitimately occupies two positions of one chart. Nothing here stores a sibling edge — two people sharing a parent are siblings, and a stored one would go stale.",
  stemma_folder_events:
    "What happened, and when. Dates are five columns rather than one, because genealogical dates are ranges with qualifiers: about 1850, before 1900, between 1852 and 1855, 24 Feb 1750/51.",
  stemma_folder_places:
    "Where it happened, under the name it had at the time. Danzig and Gdansk are one place and two names, each with the years it was current.",
  stemma_folder_evidence:
    "How we know. Two censuses giving different birth years are kept as two assertions with their citations and one marked as the conclusion — conflicting evidence is a thing to display, not a thing to overwrite.",
  stemma_folder_media:
    "Photographs, scans and recordings, with who is in them and what they are attached to. A media row naming a living person cannot be published, and a trigger rather than a policy is what enforces it.",

  /* ---- the system group ----------------------------------------------- */
  stemma_note_system_group:
    "The columns the database maintains: the row's id, and who touched it when. Collapsed because they are rarely the question, present because \"who changed this?\" has to have an answer that is not the activity log.",
  stemma_note_system_id:
    "The row's uuid. Readonly — Directus generates it and the database has a default besides. Worth having on the form so it can be copied without reading it out of the address bar.",

  /* ---- collections --------------------------------------------------- */
  stemma_note_trees:
    "One family tree. Everything else in this database carries a reference to one of these rows, and `is_public` on it is half of the rule that decides what an anonymous visitor may read.",
  stemma_note_tree_members:
    "Who may work on a tree, and in what capacity. A person can belong to many trees and a tree has many members — a genuine many-to-many, not a column on the user.",
  stemma_note_tree_invitations:
    "A membership that has not happened yet: somebody invited by email before they have an account.",
  stemma_note_persons:
    "A person as one tree records them. Deliberately thin: names live in person_names because people have more than one, and facts live in events because columns on this table run out.",
  stemma_note_person_names:
    "Every name a person is recorded under — at birth, on marriage, on the ship manifest, in orders. A single name column throws away the thing people actually search on.",
  stemma_note_couples:
    "A union between two people. Called couples rather than marriages because many unions were never marriages and produced children regardless. Marriage is an event on this row; so is divorce; so is remarrying each other — one couple, many events.",
  stemma_note_parentage:
    "One parent–child edge, with the nature of the link on it. This is why the schema is a graph and not mother_id/father_id: a child may have two birth parents and two adoptive ones on record, and all four are ordinary.",
  stemma_note_associations:
    "Relationships that are neither descent nor union: enslaved by, apprenticed to, employed by. Directed — person_a is the one the type describes. Roles inside an event (witness, godparent) belong on event_participants instead.",
  stemma_note_event_types:
    "The vocabulary of things that happen. A row with no tree is global; a tree may add its own. GEDCOM lacks half of what genealogists record, which is why this is a table and not a fixed list.",
  stemma_note_events:
    "Where the facts live. Filed under exactly one subject — a person or a couple — with any number of other people through participants. Two events of one type on one person is how conflicting evidence is kept: both cited, one marked the conclusion.",
  stemma_note_event_participants:
    "Everyone in an event who is not its subject: the godparents at a baptism, the household on a census line, the witnesses to a will. One event, many people, rather than eight events nobody can see belong together.",
  stemma_note_places:
    "A place as this tree knows it. Per tree, because a street address is private; the gazetteer ids are how two trees agree that Gdańsk is Gdańsk without sharing a row.",
  stemma_note_place_names:
    "What a place was called, and when. Danzig until 1945, Gdańsk since. An event shows the name that was valid on its date.",
  stemma_note_repositories:
    "Where sources are kept: an archive, a parish, a website, somebody's attic.",
  stemma_note_sources:
    "A record set — the 1881 census, a parish register, a gravestone, a book. Not the specific page; that is the citation.",
  stemma_note_citations:
    "The specific place in a source and what it says there. Carries the Genealogical Proof Standard's three questions: what kind of source, what kind of information, what kind of evidence.",
  stemma_note_citation_links_collection:
    "Which names, edges, events and places a citation supports. A junction; edit from the citation.",
  stemma_note_media:
    "A file as this tree describes it: caption, date, who holds the rights. The bytes are in the file library; this row is what may be said about them, and whether they may be published.",
  stemma_note_media_subjects:
    "Who is in a photograph, and where. A face becomes a link.",
  stemma_note_media_links_collection:
    "What a media item illustrates. A junction; edit from the media item.",

  /* ---- shared ---------------------------------------------------------- */
  stemma_note_row_tree:
    "The tree this row belongs to. Carried on every collection so the public filter is one hop — and the database checks it agrees with the rows this one points at.",
  stemma_note_row_tree_optional:
    "Empty means global: every tree sees this row. Set a tree to make it that tree's own.",
  stemma_note_private_notes:
    "Working notes. Never shown to the public, whoever the row is about.",
  stemma_note_is_restricted:
    "Withheld from the public regardless of anything else — a wish, not a legal status. For the suicide, the illegitimacy, the adoption a family does not want seen. Also set by the embargo after death.",
  stemma_note_confidence:
    "How far to trust this. GEDCOM's scale: 0 unreliable or estimated, 1 questionable, 2 secondary evidence, 3 direct and primary.",

  /* ---- dates ------------------------------------------------------------- */
  stemma_note_date_original:
    "The date exactly as the source gives it — abt 1850, bef 1900, 24 Feb 1750/51, 'the winter grandmother died'. Never parsed away. The four fields below are derived from it and can be corrected by hand.",
  stemma_note_date_qualifier:
    "How the range below should be read. Between is one moment somewhere in the range; period is the whole range. Before and after leave one end open. Phrase means no range could be made of it.",
  stemma_note_date_earliest:
    "The earliest day this could be, in the Gregorian calendar whatever the original used. Empty for 'before' dates and phrases.",
  stemma_note_date_latest:
    "The latest day this could be, Gregorian. Empty for 'after' dates and phrases. Sort on earliest, display the original.",
  stemma_note_date_calendar:
    "The calendar the original was written in. The range is always Gregorian; this says what it was converted from.",
  stemma_note_date_time: "Time of day, where a record gives it. Birth order of twins; little else.",
  stemma_note_age_recorded:
    "The age as the record states it — 'aged 74' on a death certificate. Kept because it is the evidence for a calculated birth year, not a substitute for one.",

  /* ---- trees --------------------------------------------------------------- */
  stemma_note_tree_name: "What the family calls itself.",
  stemma_note_tree_slug:
    "The tree's segment in a public URL. Lower-case letters, digits and hyphens. It appears in links people email to relatives, and it cannot change once the tree has been public.",
  stemma_note_tree_description: "A paragraph for the public page, if the tree has one.",
  stemma_note_tree_is_public:
    "Half of the public security model. Off: nothing in the tree is readable without a membership, no exceptions. On: the other half still applies — living and restricted people stay hidden.",
  stemma_note_tree_is_listed:
    "Whether a public tree appears in any index. Off is unlisted: reachable by URL, findable by nobody.",
  stemma_note_tree_first_published_at:
    "When is_public was first switched on. Set once by the database; freezes the slug.",
  stemma_note_tree_owner:
    "The account answerable for this tree. Always also a member at owner; if this account is removed, the database promotes another owner.",
  stemma_note_tree_home_person: "Where the public site opens: the tree's starting person.",
  stemma_note_tree_legacy_contact:
    "Who to contact about this tree if its owner cannot be reached. Genealogists die; the tree is what the family wants.",
  stemma_note_living_cutoff_years:
    "Someone born more than this many years ago with no death recorded is flagged for review as presumed dead. Flagged, never flipped — there are 110-year-olds.",
  stemma_note_privacy_years_after_death:
    "Keep a person restricted for this many years after their death. Zero publishes on death. Some archives use 30; some families, 'not while the widow is alive'.",
  stemma_note_default_name_order:
    "Whether names in this tree are given-first (Jan Kowalski) or surname-first (KOWALSKI Jan, 王 明). A name row can override it.",
  stemma_note_particle_sorting:
    "Whether 'van Gogh' sorts under G (ignore the particle — Netherlands) or under V (include it — Belgium, the English-speaking world).",
  stemma_note_default_calendar: "What a date is assumed to be written in when nothing says otherwise.",
  stemma_note_member_role:
    "Owner administers membership. Editor changes anything. Contributor adds but does not delete. Viewer reads, including the living people an anonymous visitor cannot see.",
  stemma_note_invitation_token: "Generated by the database. The invitation link carries it.",

  /* ---- persons ---------------------------------------------------------------- */
  stemma_note_person_display_name:
    "Maintained by the database from the name list — lowest sort order wins, in the name's own order. Read-only: editing it here would be a second source of truth. It exists because without it every list and dropdown renders a raw id.",
  stemma_note_person_sort_name:
    "Surname first, particle handled per the tree's convention. The database maintains it; lists sort on it.",
  stemma_note_person_public_id:
    "Eight characters, generated once, unique in the tree. The public URL uses this rather than a name that will change or a uuid nobody can read aloud.",
  stemma_note_family_graph:
    "Who this person is connected to, drawn from the parentage and couples edges. Read only — click a name to open them. Edit the family through Parentage and Couples, which are the source of truth this reads.",
  stemma_iface_person_graph: "Person graph",
  stemma_iface_person_graph_desc:
    "Parents, partners and children on the person's own form, with the standard pedigree symbols. Navigates on click; stores nothing.",
  stemma_iface_show_events: "Show recent events",
  stemma_note_person_portrait:
    "The face shown on charts. Only ever reaches the public site when the media row is marked publishable, its licence allows it, and nobody in the picture is living or restricted — a photograph of a dead ancestor under all-rights-reserved is still not ours to publish.",
  stemma_note_person_sex:
    "The sex a source recorded — which is not a claim about gender identity, and is not always known. Named sex_recorded so the distinction survives contact with whoever reads the column next.",
  stemma_note_person_is_living:
    "Stored and maintained, never computed at read time: the public filter has to stay a flat comparison. Default on — a person nobody has assessed is withheld, not published. A death event switches it off.",
  stemma_note_living_basis:
    "Why the living flag says what it says: a death record, an age past the tree's cutoff, somebody's word, or nobody has looked.",
  stemma_note_multiple_birth:
    "Twins and triplets share this value. Not derivable from shared parents — it needs the same birth — and GEDCOM has no marker for it.",
  stemma_note_person_biography:
    "Prose fit to publish. Shown on the public page when the person is.",
  stemma_note_person_notes:
    "Research notes. Where a living relative's address, an unproven allegation or a cause of death ends up — so never public, even for the dead.",

  /* ---- names -------------------------------------------------------------------- */
  stemma_note_name_type:
    "Birth is the name recorded at birth; married one taken on a union; aka a variant or a daily-use name; immigrant the one on the manifest; professional a stage, pen or trade name; adopted the one assumed at adoption; religious one taken in orders; legal one changed by deed; title a peerage or office used as a name.",
  stemma_note_name_type_phrase: "For type 'other': what kind of name this is, in words.",
  stemma_note_name_given: "Forenames, in the order the source gives them.",
  stemma_note_name_particle:
    "van, de la, von, af, ibn. Displayed with the surname; sorted with or without it per the tree's convention.",
  stemma_note_name_surname:
    "Family name. Left empty where a culture does not use one, rather than filled with a placeholder that will later be searched for and found.",
  stemma_note_name_patronymic:
    "Jónsdóttir, Ivanovich, bint Ahmad. Not a family name and not inherited; shown where the tree's name order puts it.",
  stemma_note_name_prefix: "Title or honorific written with the name — Dr, Sir, Rev.",
  stemma_note_name_suffix: "Jr, III, or a post-nominal.",
  stemma_note_name_nickname: "What they were actually called.",
  stemma_note_name_script_original:
    "The name in its own script, unromanised — Hebrew, Arabic, Cyrillic, Han. Kept beside the transliteration because a transliteration is a lossy guess and the original is the evidence.",
  stemma_note_name_lang:
    "Language tag (he, ar, ru, zh-Hant) so a renderer can choose direction and font, and so two romanisations say what they romanise.",
  stemma_note_name_order:
    "Given-first or surname-first for this name. Empty uses the tree's default.",
  stemma_note_name_parts:
    "Parts the columns cannot hold: generation names, clan names, geographic or occupational bynames. A list of type/value pairs.",
  stemma_note_name_sort_order:
    "Which name comes first. The lowest is the one shown for this person, so ordering the list is how a contributor chooses — rather than a separate primary flag that could contradict the order it sits beside.",
  stemma_note_name_event:
    "The event that gave this name its date — the marriage, the naturalisation, the profession.",

  /* ---- couples & edges ------------------------------------------------------------ */
  stemma_note_couple_person:
    "The two people in the union. Unordered: (a, b) and (b, a) are the same couple, and the database enforces it with a unique index on the sorted pair.",
  stemma_note_couple_sort: "Order among a person's unions when the events do not date them.",
  stemma_note_parentage_parent: "The parent in this edge.",
  stemma_note_parentage_child: "The child in this edge.",
  stemma_note_parentage_lineage:
    "How the two are related. Birth is what a register asserts — 'child of' — and claims nothing about genetics. Recording the kind rather than assuming it is what lets adoption, step-parents, fostering, guardianship, donor conception and surrogacy coexist on one child without any being a special case.",
  stemma_note_lineage_phrase: "For lineage 'other': the relationship in words.",
  stemma_note_edge_status:
    "An edge is an assertion. Disputed keeps it on the chart with a mark; disproven keeps it on file and off the chart — the wrong answer stays, with the reason. Conclusion is the one the tree stands behind.",
  stemma_note_edge_event: "The event behind this edge — the adoption order, the fostering placement, the guardianship grant.",
  stemma_note_edge_sort: "Birth order among siblings when the dates are missing. Dates win when present.",
  stemma_note_association_a: "The person the relationship type describes.",
  stemma_note_association_type: "Read as: person_a [type] person_b.",
  stemma_note_association_b: "The other party.",
  stemma_note_association_phrase: "For type 'other': the relationship in words.",

  /* ---- events --------------------------------------------------------------------- */
  stemma_note_event_type_code: "A short machine key, unique within the tree (or globally for global rows): birth, census, occupation.",
  stemma_note_event_type_label: "What the type is called on screen.",
  stemma_note_applies_to: "Whether this kind of event is filed under a person, a couple, or either.",
  stemma_note_is_vital: "Birth, death, marriage and their kin — the events a timeline summary shows first.",
  stemma_note_ends_life: "An event of this type on a person switches their living flag off. Death, burial, cremation; a tree may add its own.",
  stemma_note_gedcom_tag: "The GEDCOM 7 tag this exports as. Empty exports as EVEN with a TYPE.",
  stemma_note_event_type: "What kind of event. Add a type to the list if the right one is missing.",
  stemma_note_subject_person: "Whose event this is. Exactly one of person or couple.",
  stemma_note_subject_couple: "Whose event this is, when it belongs to a union — a marriage, a divorce, a joint census entry.",
  stemma_note_event_value:
    "What the record says the fact was: Blacksmith for an occupation, Roman Catholic for a religion, the cause on a death.",
  stemma_note_event_place: "Where, normalised to a place in this tree.",
  stemma_note_place_original:
    "Where, exactly as the record wrote it — 'Danzig, Westpreußen'. The place link is the interpretation; this is the evidence.",
  stemma_note_is_conclusion:
    "Of several events of one type on one person, the one the tree stands behind. The chart shows this one; the person page shows all of them. At most one per type per subject.",
  stemma_note_has_living_participant:
    "Set by the database when any participant is living or restricted. Keeps the public filter flat.",
  stemma_note_event_description: "A sentence fit to publish about this event.",
  stemma_note_participant_role: "What this person was in the event: witness, godparent, informant, a household member on a census line.",
  stemma_note_role_phrase: "For role 'other': the role in words.",
  stemma_note_participant_detail: "What the record said about them here — 'aged 12, scholar, born Kent'.",

  /* ---- places ----------------------------------------------------------------------- */
  stemma_note_place_name: "The current or most recognised name. Historical names go in the name list.",
  stemma_note_place_type: "Ships and 'at sea' are real birthplaces.",
  stemma_note_parent_place: "The place this sits in, as of now. Historical jurisdiction lives in the record's own words on each event.",
  stemma_note_precision: "How much of the map this pin means: a country's centroid is not a street.",
  stemma_note_geonames_id: "GeoNames identifier, for agreeing with other trees and other systems.",
  stemma_note_wikidata_id: "Wikidata Q-number.",
  stemma_note_gov_id: "GOV (Genealogisches Orts-Verzeichnis) identifier — the German genealogy standard for historical places.",
  stemma_note_has_public_reference:
    "Set by the database when an event of a non-living, non-restricted person points here. A street known only from a living person's residence stays private.",
  stemma_note_valid_from: "When this name came into use. Empty means 'as far back as known'.",
  stemma_note_valid_to: "When this name fell out of use. Empty means 'still current'.",

  /* ---- evidence --------------------------------------------------------------------- */
  stemma_note_publication: "Publisher, place and year, or the archive's series and reference.",
  stemma_note_source_type:
    "Original: the record itself. Derivative: an index, transcription or abstract of it. Authored: a book or article that interpreted records. The first question Evidence Explained asks.",
  stemma_note_source_repository: "Where this source is held.",
  stemma_note_locator: "Page, entry, folio, image number — whatever finds the exact spot again.",
  stemma_note_citation_url: "A link to the image or entry. Consider archiving it; links rot.",
  stemma_note_date_accessed: "When you saw it. Websites change.",
  stemma_note_information:
    "Primary: the informant was present at the fact. Secondary: they heard it. Undetermined: the record does not say who informed.",
  stemma_note_evidence:
    "Direct: answers the question by itself. Indirect: answers it only with other facts. Negative: the record was searched and the person was not there — keep these; they are the research log's most valuable entries.",
  stemma_note_citation_confidence: "How far this citation can be trusted for what it is cited for.",
  stemma_note_transcription: "What the record says, word for word, including the mistakes.",
  stemma_note_citation_text: "The citation formatted as you would print it, if you want to write it yourself.",
  stemma_note_citation_links: "What this citation supports.",
  stemma_note_is_public_ok: "Set by the database from the linked row's own visibility.",

  /* ---- media --------------------------------------------------------------------------- */
  stemma_note_licence: "Under what terms this may be shown. Unknown is not permission.",
  stemma_note_publishable:
    "Whether this may appear on the public site. Off unless the licence allows it and nobody in it is living or restricted.",
  stemma_note_transcript: "For audio and video: what is said, with timestamps if you have them.",
  stemma_note_media_links: "What this illustrates.",
  stemma_note_region: "Where in the image, as fractions of width and height (0–1), so the box survives a resize.",
  stemma_note_file_tree: "Which tree this file belongs to. Copied from the media row that references it; the public asset endpoint reads it.",
  stemma_note_file_is_public_ok: "Set by the database: the file's media row is publishable and shows nobody living or restricted.",

  /* ---- validation ------------------------------------------------------------------------ */
  stemma_vm_slug: "Lower-case letters, digits and hyphens only — this ends up in a URL that people share.",
};

/* ---- choice labels ------------------------------------------------------------------------ */

const humanize = (v: string): string =>
  v.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** Where the mechanical label is not the right label. */
const LABEL_OVERRIDES: Record<string, string> = {
  aka: "Also known as",
  cc_by: "CC BY", cc_by_sa: "CC BY-SA", cc_by_nc: "CC BY-NC", cc0: "CC0",
  all_rights_reserved: "All rights reserved",
  at_sea: "At sea",
  given_first: "Given name first", surname_first: "Surname first",
  death_record: "Death recorded", presumed_by_age: "Presumed by age", reported: "Reported by a relative",
  french_republican: "French Republican", islamic: "Islamic (Hijri)", japanese: "Japanese era",
  enslaved_by: "enslaved by", apprenticed_to: "apprenticed to", employed_by: "employed by", servant_of: "servant of",
  tenant_of: "tenant of", neighbour_of: "neighbour of", friend_of: "friend of", business_partner_of: "business partner of",
  household_member: "Household member",
  confidence_0: "0 — unreliable or estimated",
  confidence_1: "1 — questionable",
  confidence_2: "2 — secondary evidence",
  confidence_3: "3 — direct and primary",
};

const VOCABULARIES: readonly (readonly string[])[] = [
  TREE_ROLES, SEXES, LIVING_BASES, NAME_TYPES, NAME_ORDERS, LINEAGES, EDGE_STATUSES, ASSOCIATION_TYPES,
  APPLIES_TO, EVENT_CATEGORIES, PARTICIPANT_ROLES, PLACE_TYPES, PRECISIONS,
  REPOSITORY_TYPES, SOURCE_TYPES, INFORMATION, EVIDENCE, MEDIA_KINDS, LICENCES,
  DATE_QUALIFIERS, CALENDARS,
  ["pending", "accepted", "expired", "revoked"],
  ["ignore", "include"],
  ["confidence_0", "confidence_1", "confidence_2", "confidence_3"],
];

const LABELS: Record<string, string> = {};
for (const list of VOCABULARIES) {
  for (const v of list) LABELS[`stemma_c_${v}`] = LABEL_OVERRIDES[v] ?? humanize(v);
}

export const STRINGS: Record<string, string> = { ...NOTES, ...LABELS };
