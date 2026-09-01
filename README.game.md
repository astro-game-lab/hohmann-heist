# __GAME_NAME__

__GAME_DESC__

An [astro-game-lab](https://github.com/astro-game-lab) game — real orbital mechanics, playable.

> Freshly bootstrapped from the org template. Replace this note, and fill in the
> sections below, as the repo becomes real.

## Play

_Link to the deployed build, or the command to run it locally._

## Status

Early. Not yet playable.

## The astrodynamics

_One or two sentences: which concept this game is built around, and what the
player should come away understanding._

See [`docs/PHYSICS.md`](docs/PHYSICS.md) for the model — units, frames, what is
neglected, and how the numbers were validated. If the simulation ever disagrees
with a textbook, that is a bug: please
[report it](https://github.com/astro-game-lab/__GAME_SLUG__/issues/new/choose)
using the physics discrepancy template.

## Development

### Requirements

_Toolchain and versions._

### Setup

```bash
git clone https://github.com/astro-game-lab/__GAME_SLUG__.git
cd __GAME_SLUG__
# install dependencies
```

### Common tasks

| Task | Command |
| --- | --- |
| Run locally | _todo_ |
| Test | _todo_ |
| Lint | _todo_ |
| Build | _todo_ |

## Documentation

- [`docs/PHYSICS.md`](docs/PHYSICS.md) — the simulation model and its validation.
- [`docs/DESIGN.md`](docs/DESIGN.md) — what the game is and who it is for.
- [`CHANGELOG.md`](CHANGELOG.md) — notable changes, including physics-model changes.
- [`CLAUDE.md`](CLAUDE.md) — conventions, for humans and for Claude Code.

## Contributing

Contributions are welcome — code, playtest feedback, art, scenario design, and
bug reports all count. See the org
[contributing guide](https://github.com/astro-game-lab/.github/blob/main/CONTRIBUTING.md),
which covers the extra requirements for physics changes: state your units and
frame, cite your source, and include a validation test.

## Licence

Code is [MIT](LICENSE). Game assets are
[CC BY 4.0](LICENSE-ASSETS.md). Third-party material and its terms are listed in
[`ATTRIBUTIONS.md`](ATTRIBUTIONS.md).
