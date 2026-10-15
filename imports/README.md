# imports/

Drop source files here before running import scripts.
**All contents are gitignored** — files stay local and are never committed.

## Subdirectories

| Directory  | Command                        | What goes here                          |
|------------|--------------------------------|-----------------------------------------|
| `chats/`   | `bun run new-flow-from-chat`   | Group chat export files (`.txt`)        |
| `pdfs/`    | `bun run new-from-pdf`         | PDF documents → posts with page images  |
| `images/`  | `bun run new-from-images`      | Image folders → gallery posts           |

## chats/ — auto-import workflow

Drop `.txt` chat export files into `imports/chats/` and run:

```bash
bun run new-flow-from-chat            # import all new files
bun run new-flow-from-chat --dry-run  # preview first
bun run new-flow-from-chat --all      # re-import everything
```

Already-processed filenames are tracked in `imports/chats/.imported`.
Running the command again will only pick up files added since the last run.

### Expected file format

```
username YYYY-MM-DD HH:mm:ss
message line 1
message line 2

username YYYY-MM-DD HH:mm:ss
message line 1
```

### Options

| Flag              | Effect                                              |
|-------------------|-----------------------------------------------------|
| `--author "Name"` | Only include messages from one participant          |
| `--append`        | Append to an existing flow instead of skipping      |
| `--dry-run`       | Preview without writing any files                   |
| `--all`           | Re-import all files, ignoring previous import history |
