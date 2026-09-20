import type { Collection } from "./_helpers.js";
import { FOLDERS } from "./_theme.js";
import { trees, treeMembers, treeInvitations } from "./trees.js";
import { persons, personNames, couples, parentage, associations } from "./graph.js";
import { eventTypes, events, eventParticipants } from "./events.js";
import { places, placeNames } from "./places.js";
import { repositories, sources, citations, citationLinks } from "./evidence.js";
import { media, mediaSubjects, mediaLinks, fileFields, fileRelations } from "./media.js";

/**
 * Every collection, in the order they are created.
 *
 * Fields are created with their collection and relations afterwards, once
 * every side exists — so this order is about readability, not
 * correctness. It reads as the model reads: who may see, who is in it,
 * what happened, where, how do we know, what does it look like.
 *
 * Twenty. Core tier allows twenty-five; the licence lifts it.
 */
export const COLLECTIONS: Collection[] = [
  trees, treeMembers, treeInvitations,
  persons, personNames, couples, parentage, associations,
  eventTypes, events, eventParticipants,
  places, placeNames,
  repositories, sources, citations, citationLinks,
  media, mediaSubjects, mediaLinks,
];

/**
 * The six nav folders the twenty above nest under.
 *
 * Separate from COLLECTIONS because they are not part of the data model:
 * no table, no rows, no permissions. They exist so the sidebar is six
 * things instead of seventeen. `verify.ts` counts collections that have a
 * schema, which is why adding these does not move the README's figure.
 */
export { FOLDERS };

export const SYSTEM_FIELDS = { directus_files: fileFields };
export const SYSTEM_RELATIONS = fileRelations;
