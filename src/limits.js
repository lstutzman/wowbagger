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
