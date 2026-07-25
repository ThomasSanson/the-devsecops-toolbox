# AI tool drop-ins

The toolbox can drive its test-first cycle with an AI assistant
(`task devsecops:code:agent:red`, `:green`, `:refactor` — see
`.agent/workflows/ai-development-cycle.md`). It does not ship with one, and it
names none: tools and model names move faster than a framework can follow, and a
name baked in here would be stale within months.

Instead, each tool you want to use is **one file dropped in this directory**.

## The contract

Create `<tool>.sh` here with two lines:

```sh
# The command that reads the prompt on STANDARD INPUT and edits the working
# tree. Its first word is the binary looked for on this machine.
AGENT_EXEC_CMD="my-tool run --model {{MODEL}}"

# Optional: how that tool lists its OWN models. The framework holds no model
# name; it asks the tool.
AGENT_MODELS_CMD="my-tool models list"
```

`{{MODEL}}` is replaced by `TASK_AGENT_MODEL` when the phase runs.

`example.sh.dist` next to this file is a working template: copy it to
`<tool>.sh` and fill in the two values. Only files ending in `.sh` are picked
up, so the template itself is never used by mistake.

## What the command must do

- read the prompt on standard input;
- edit the working tree;
- leave the working tree changed. **A run that leaves `git diff` empty is a
  failure**, not a success: the phase asked for work and no work came back.
- not commit and not push. The phase tasks and the human do that.

## Seeing what a machine holds

```bash
task devsecops:code:agent:doctor
```

It lists every drop-in, whether its binary is really on this machine, and the
command each one offers for listing its models. A machine with no drop-in is
told so, instead of failing later on a command that does not exist.

`TASK_AGENT_EXEC_CMD` in the environment overrides all of it — useful in CI, or
for a one-off run.
