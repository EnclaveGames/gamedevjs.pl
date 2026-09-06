# People

- Files starting with a `_` are treated as drafts and ignored.
- Files not ending in a `.yaml` extension are ignored.
  This is subject to change - .md will likely become a first class citizen here as well.
- Filenames are incosequential (slugs are derived from a Person's name or manually specified).
  Use any file naming scheme that you prefer.


## Person
___
Fields not marked as optional are required.

| Field        | Type   | Tags     | Description |
|---           |---     |---       |---|
| **name**     |        |          ||
| name.given   | string |          | First name |
| name.family  | string |          | Surname; used internally for lexicographic sorting |
| slug         | string | optional | When not specified, derived from name.given + name.family. Can be manually specified in case of collisions |
| homepage     | url    | optional | homepage URL |
| github       | string | optional | GitHub username - *not* a URL |
| twitter      | string | optional | Twitter handle, without the "@" - *not* a URL |
| slack        | string | optional | Display name in the **Gamedev.js** Slack workspace |
| linkedin     | url    | optional | LinkedIn profile URL |
| **photo**    |        |          ||
| photo.normal | string |          | URL to a ideally 125x125px sized photo of the Person. Can be fully-qualified or relative/absolute path (in relation to the client's domain URL) |
| **bio**      |        |          ||
| bio.full     | string | markdown | Full biography. Displayed on a Person's profile page. When short enough (see below) also used everywhere else. No limit in length. |
| bio.summary  | string | markdown, optional| When not specified, the full bio will be used - unless it exceeds a max length of 400 characters, in which case it will be truncated and the resulting substring will be used as the summary |
