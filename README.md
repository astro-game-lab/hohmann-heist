# .repo-template

Template repository for [astro-game-lab](https://github.com/astro-game-lab) games.

Stack-agnostic for now: it carries the org's licensing, documentation, and conventions, and leaves the toolchain to you. Language scaffolds will land under `stacks/` once the first game repos have settled on a shape worth copying.

## Start a new repository

1. **Use this template → Create a new repository** on GitHub, or:

   ```bash
   gh repo create astro-game-lab/<name> --template astro-game-lab/.repo-template --public
   ```

2. Clone it, then run the bootstrap script from the repo root:

   ```bash
   ./bootstrap.sh <name> ["One-line description"]
   ```

   For example:

   ```bash
   ./bootstrap.sh orbit-runner "A rendezvous puzzle game in the browser."
   ```

3. Set up your toolchain, fill in the docs, and commit.

The script substitutes the placeholders below across every file, then deletes itself. What is left is a normal repository with no template scaffolding in it. It refuses to run on a dirty working tree, so `git checkout .` will always get you back.

### Placeholders

| Placeholder | Becomes | Example |
| --- | --- | --- |
| `__GAME_SLUG__` | the repo name, as given | `orbit-runner` |
| `__GAME_NAME__` | title-cased from the slug | `Orbit Runner` |
| `__GAME_PKG__` | slug as a valid identifier | `orbit_runner` |
| `__GAME_DESC__` | the description argument | `A rendezvous puzzle game.` |
| `__YEAR__` | the current year | `2026` |

Substitution applies to file and directory names too, so a path like `src/__GAME_PKG__/` becomes `src/orbit_runner/`.

## What you get

| File | Purpose |
| --- | --- |
| `README.game.md` | Becomes the new repo's `README.md`, replacing this one. |
| `docs/PHYSICS.md` | The model declaration — units, frames, time scale, what is neglected, and how each claim was validated. Filling this in is how this org keeps its simulations honest. |
| `docs/DESIGN.md` | Game design doc skeleton, including an explicit list of where the game layer departs from the physics. |
| `CLAUDE.md` | The org's simulation conventions, scoped to the repo, so Claude Code sessions start with them loaded. |
| `LICENSE` | MIT, for code. |
| `LICENSE-ASSETS.md` | CC BY 4.0, for art, audio, and authored content. |
| `ATTRIBUTIONS.md` | Provenance table for third-party assets, data, and constants. |
| `CHANGELOG.md` | Keep a Changelog format, with a dedicated section for physics-model changes. |
| `.editorconfig` | Shared indentation and line-ending rules. |
| `.gitattributes` | Line-ending normalization, binary markers, and commented-out Git LFS patterns. |
| `.gitignore` | Common OS, editor, environment, and large-data ignores. |

Not included, because the organization provides them: issue templates, the pull request template, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, and `SUPPORT.md` are inherited from [`astro-game-lab/.github`](https://github.com/astro-game-lab/.github). Add a local copy only when a repo genuinely needs to override one.

## What is not here yet

- **Stack scaffolds.** The org expects TypeScript-in-the-browser for most games and Python for simulation-heavy work, with room for more later. Neither is scaffolded yet — set up the toolchain by hand, and once a shape proves itself, promote it into `stacks/` here.
- **CI workflows.** They depend on the stack, so they arrive with it.
- **Dependabot config.** Ecosystem-specific; same reasoning.
