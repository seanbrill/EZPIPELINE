# AI assistant

EZPIPELINE ships with an assistant you can talk to in plain language: "list my
pipelines", "add a build step to staging", "which env vars does test need". It
reaches your instance through a fixed set of tools rather than by poking at
files, and this page is mostly about where the edges of that set are.

> **This page was rewritten after the engine changed.** The assistant used to
> shell out to the Claude Code CLI. It now calls the Anthropic API directly
> from `apps/server/src/services/AnthropicAssistant.ts`. Everything below
> describes the new arrangement. [What changed, and why it matters](#what-changed-and-why-it-matters)
> covers the difference, because the old setup made a safety promise that was
> not kept and the new one is the reason it now is.

---

## Setting it up

One environment variable, in the `.env` at the root of the install:

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

Restart the server. That is the whole setup: there is no install step, no
login flow, and deliberately **no field in the interface to paste a key
into**. A key entered through the browser would have to travel to the server
and be stored somewhere the browser could reach it again. Keeping it in the
server environment means only someone with shell access on the host can set
it.

Optionally:

```bash
ANTHROPIC_MODEL=claude-opus-5     # the default
```

which exists so you can trade capability for cost without rebuilding.

If the key is missing, the assistant says so in the chat panel with the
variable name, the file, and the fact that a restart is needed. It does not
fail with a bare code.

### Checking

```bash
curl -s -H "Authorization: Bearer $TOKEN" localhost:5001/api/ai/status
```

```json
{"installed":true,"loggedIn":true,"engine":"anthropic-api",
 "configured":true,"model":"claude-opus-5","message":null}
```

Read `configured`, `engine` and `model`. `installed` and `loggedIn` are kept
only because the current client switches on those two names; nothing is
installed at runtime any more and nobody logs in. `installed` is now always
`true` and `loggedIn` just mirrors `configured`.

---

## What it can do

Eleven tools. This list is the complete set of effects the assistant can have
on your instance; it has no shell and no filesystem access outside them.

### Reading

| Tool | What it does |
|---|---|
| `list_pipelines` | Every pipeline and its status |
| `read_yaml_config` | The contents of a pipeline YAML |
| `get_env_keys` | Variable **names** from a pipeline `.env`, never values |
| `get_global_env_keys` | The same for the global env file |
| `get_global_resources` | Files in the global resources directory |
| `get_build_history` | Past builds |
| `list_documentation` | Filenames in this `docs/` directory |
| `read_documentation` | The contents of one of them |

### Writing

| Tool | What it does |
|---|---|
| `update_yaml_config` | Rewrites a pipeline YAML |
| `set_env_variable` | Sets one key in a pipeline `.env` |
| `set_global_env_variable` | Sets one key globally |

### What it deliberately cannot do

The MCP server exposes sixteen tools. The assistant gets eleven. The five it
does not get are the destructive ones: `execute_rollback`,
`generate_rollback_plan`, `delete_global_env_variable`,
`delete_global_resource` and `move_pipeline`.

The reasoning is written into the source and worth repeating: a chat box with
no confirmation step should not be able to roll back production or delete a
global resource on the strength of a sentence that might have come from a
pasted log line. If you ask the assistant to roll something back, it will tell
you it cannot and point you at the UI. External MCP clients still get the full
sixteen; see [The MCP server is still there](#the-mcp-server-is-still-there).

### Why the env tools are split

`get_env_keys` parses the file and returns only names, so the model can answer
"is `DEPLOY_KEY` set?" without seeing what it is set to. `set_env_variable`
writes one key by reading the file, replacing one line and writing it back,
entirely inside the server. Values never enter the model's context in either
direction.

---

## What changed, and why it matters

The previous engine spawned the Claude Code CLI like this:

```
node <sandbox>/node_modules/@anthropic-ai/claude-code/cli.js \
  --permission-mode bypassPermissions \
  --dangerously-skip-permissions \
  -p "<your message>"
```

with `cwd` set to `apps/server/ai_sandbox`.

Earlier versions of this page described that as "strict sandboxing", said the
agent was "confined to the `ai_sandbox` directory" and "cannot traverse up
(`../../`) to read system files", and called its access to code "read-only".

**None of that was enforced.** `cwd` is where relative paths start, not a
jail; the CLI's `Read` and `Bash` tools take absolute paths, and both flags
above exist to remove the CLI's own confirmations. The process ran as the
server's user with the server's access to the disk, the network, the SQLite
database and every pipeline `.env` on the box. The only thing standing between
the model and any of that was a paragraph in
`apps/server/ai_sandbox/INSTRUCTIONS.md` asking it not to. That is a good
instruction, and it was probably obeyed most of the time. It was not a
boundary and should never have been documented as one.

The new engine has no shell and no filesystem primitive. Every effect it can
have is one of the eleven tools above, each of which validates its own
arguments. In particular, file paths go through a containment check that
rejects absolute paths, rejects any `..` segment, and re-verifies after
resolution that the result is still inside the pipelines directory.

So the promise this page used to make is now actually kept, by code rather
than by wording. That is the point of the change.

### What is left over

`ClaudeManager.ts` is still in the tree but nothing imports it any more. So is
`ai_sandbox/`, with the old CLI install and `INSTRUCTIONS.md` in it. Neither
is loaded. They can be removed whenever their owner wants to; that is a change
in `apps/`, which this page's author does not own.

---

## Using it

1. Open the assistant from the terminal icon at the bottom right.
2. Ask it something.

That is it. There is no initialize step and no authentication step. If you
press the old **Initialize Agent** button it answers with a sentence saying
there is nothing to install and that the assistant is ready, rather than
pretending to do work.

The window is draggable, and has controls to clear the transcript, copy it and
restart the conversation. Restarting is now cheap: it clears an array in the
server process rather than killing and respawning anything.

---

## The API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/ai/status` | The shape above |
| POST | `/api/ai/action` | `{action, socketId, input?}` |
| POST | `/api/ai/setup` | Reports whether a key is configured |

`action` is one of:

| Action | What happens |
|---|---|
| `spawn` | Start or restart the conversation. Returns `{status:"started"}` |
| `input` | Send a message. Returns `202 {status:"streaming"}` immediately |
| `kill` | Discard the conversation. Emits `claude-exit` |
| `install` / `login` | Explains that neither exists any more |

`socketId` is **required** on every action. The answer streams over Socket.IO,
so a request that does not say which socket to stream to is answered with
`409 socket_not_connected` or `400 socket_id_required` rather than being
silently dropped.

`input` returns 202 without waiting. An answer involving tool calls can run for
a minute or more, and holding the POST open for it makes the browser's `fetch`
time out mid-answer while the stream is arriving perfectly well.

### One socket, never broadcast

The previous implementation fell back to `io.emit()` whenever it could not
find the requesting socket, which sent one operator's transcript, including
pipeline contents and variable names, to **every** connected browser. There is
no fallback now. If the socket is gone, the request says so.

### Socket events

The event names were kept unchanged so the existing client keeps working:

| Event | Meaning |
|---|---|
| `claude-output` | A chunk of the answer |
| `claude-success` | A step finished |
| `claude-error` | Something failed, with a sentence explaining it |
| `claude-exit` | The conversation was discarded |
| `claude-init-complete` | The session is ready |

The `claude-` prefix is now a legacy name rather than a description of the
engine.

---

## Conversation state

Held per socket, in memory, in the server process:

| Limit | Value | Why |
|---|---|---|
| Max tokens per answer | 16,000 | A ceiling so a runaway generation cannot run up a bill |
| Tool rounds per message | 12 | The loop needs a stop that does not depend on the model choosing one |
| Messages kept | 60 | Trimmed on turn boundaries only |
| Idle expiry | 2 hours | |
| Concurrent sessions | 50, least-recently-used evicted | |

One in-flight request per socket. A second would interleave into the same
history.

Trimming happens on turn boundaries because a tool-use message and its result
have to stay together; slicing between them makes the API reject the whole
conversation.

Because state lives in the server process, restarting the server clears every
conversation. Nothing is persisted, and nothing about your chats reaches the
database.

---

## Permissions

The `useClaude` flag decides who may use the assistant. See
[Permissions](permissions.md).

It is worth being precise about what that grant now means, because it changed.
Under the CLI engine, `useClaude` was effectively shell access on the host.
It is not any more: the assistant can read and write pipeline YAML, read env
keys, and set env values, and that is the whole list. That is still a
significant grant, roughly equivalent to `editYaml` plus `editEnv` across
every pipeline, since the tools do not currently filter by the calling user's
per-pipeline permissions. Treat `useClaude` as at least as strong as those two
flags, everywhere.

---

## The MCP server is still there

`apps/server/src/services/MCPServer.ts` is unchanged and still exposes all
sixteen tools over Model Context Protocol, for external MCP clients. The
in-app assistant does not use it.

Calling the controllers directly rather than speaking JSON-RPC to a
subprocess was a deliberate choice: MCP exists to cross a process boundary,
the CLI *was* that boundary, and it is gone. Running a second process would
have meant a second `better-sqlite3` writer against the same database file for
no benefit.

The cost of that choice is real and worth knowing: there are now two
descriptions of the same capability surface, and they can drift. Two guards in
particular are duplicated rather than shared, the `.env` read block and the
path containment check, because they live inside `MCPServer`'s switch
statement rather than in the controllers.

---

## Troubleshooting

**"The assistant has no Anthropic API key."** Exactly what it says. Set
`ANTHROPIC_API_KEY` in the root `.env` and restart the server. There is no way
to set it from the interface.

**Nothing appears in the window.** Output is Socket.IO, not SSE. Check that
`/socket.io/` is reachable; behind a reverse proxy it needs an explicit
upgrade rule. See [Deployment](deployment.md#reverse-proxy).

**"That websocket is no longer connected."** The page reconnected with a new
socket id between your request and the answer. Reload and try again.

**It refuses to roll something back.** Correct, and intentional. Rollback is
one of the five tools the assistant does not have. Use the Versions tab.

**It says it cannot read a path.** The containment check rejected it. Paths
must be relative and inside the pipelines directory. Unlike the old engine,
this refusal comes from code rather than from the model choosing to decline.

---

[Back to the documentation index](README.md)
