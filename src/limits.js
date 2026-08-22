// The one public semantic limit on a Wowbagger item. It bounds the complete
// serialized UTF-8 Markdown item source that revision hashing and
// `source_base64` already represent, so frontmatter, decisions, extensions,
// and body all consume the same budget. It is not a body limit and it is not a
// request-transport limit: `publish-claimed` keeps its own serialized-request
// bound, which measures a different object.
//
// The value is the one work-claim version 1 already published for a
// publishable candidate, so "publishable item" has exactly one meaning at
// every candidate door.
export const MAX_ITEM_SOURCE_BYTES = 8388608;

// The bounded `list` contract's advertised numbers. They live here, beside the
// item-source bound, because `capabilities` advertises all of them and both the
// core CLI and the adapter core probe must read one definition.
//
// `list` is negotiated by its own query version: a query shape the core does
// not recognize is refused by this number rather than by the core contract
// version.
export const LIST_QUERY_VERSION = 1;
export const DEFAULT_LIST_PAGE_SIZE = 50;
export const MAX_LIST_PAGE_SIZE = 200;
// Titles are projected by Unicode code point, not byte: a byte cut can land
// inside a character and the excerpt must stay printable text.
export const MAX_LIST_TITLE_CHARACTERS = 120;
// The whole `list` response, envelope and trailing LF included, must fit this.
// A full-width page of maximum-width rows can exceed it; when it does the
// command refuses and the caller lowers `page_size`. The two bounds are
// independent on purpose: neither silently rewrites the other.
export const MAX_LIST_RESPONSE_BYTES = 131072;

// The bounded workbench projection's advertised numbers. `inspect --workbench`
// is negotiated by its own projection version, exactly as `list` is negotiated
// by its query version: a projection shape a consumer does not recognize is
// refused by this number rather than by the core contract version.
export const WORKBENCH_PROJECTION_VERSION = 1;
// Titles are projected by Unicode code point, for the same reason `list`
// projects them that way. The bound is the workbench's own: the two
// projections answer different questions and neither rewrites the other.
export const MAX_WORKBENCH_TITLE_CHARACTERS = 120;
// The largest number of entries any one variable-size workbench collection
// carries — relation lists, precondition issues, blockers, and the related IDs
// inside an issue. A longer collection is truncated and says so, so the
// projection stays bounded whatever the ledger holds.
export const MAX_WORKBENCH_COLLECTION_ENTRIES = 50;
// The whole workbench response, envelope and trailing LF included, must fit
// this. The bounded collections above put the largest possible projection well
// inside it; the check is the promise, not a page-size knob, and a response
// over it is refused rather than written.
export const MAX_WORKBENCH_RESPONSE_BYTES = 65536;
