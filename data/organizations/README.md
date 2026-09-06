# Organizations

- Files starting with a `_` are treated as drafts and ignored.
- Files not ending in a `.yaml` extension are ignored.
  This is subject to change - .md will likely become a first class citizen here as well.
- Filenames are incosequential (slugs are derived from a Organizations's name or manually specified).
  Use any file naming scheme that you prefer.


## Organization
___
Fields not marked as optional are required.

| Field        | Type   | Tags               | Description |
|---           |---     |---                 |---|
| name         | string |                    | Self-explanatory |
| slug         | string | optional           | When not specified, derived from `name` |
| homepage     | url    |                    | Homepage URL |
| **logo**     |        |                    ||
| logo.normal  | string |                    | URL to a ideally **at most** 250x250px sized logo of the Organization. The ratio is flexible. Can be fully-qualified or a relative/absolute path (in relation to the client's domain URL) |
| description  | string | markdown, optional | Description of the Organization. Some history, activity profile etc. |
