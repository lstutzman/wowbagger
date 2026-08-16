# Mutation refusal envelopes

Normative envelopes for mutation refusals that depend on Git state, which the
static mutation vectors in `../mutations/` cannot express because they run
against a plain directory rather than a repository.

Each case directory holds one `manifest.json`. The manifest declares the
scenario the test builds and the exact refusal envelope the core must return.
The revision placeholder `{{PRIOR_REVISION}}` is substituted with the revision
the prior mutation reported, so the fixture pins the contract without pinning
item serialization.
