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
