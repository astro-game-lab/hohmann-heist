# Changelog

All notable changes to Hohmann Heist are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Changes to the physics model get their own note under **Physics**, with a pointer to
the `docs/PHYSICS.md` revision — players and contributors need to know when a number
they relied on has moved.

## [Unreleased]

### Fixed
- **The planner's panel column painted over the timeline and the commit bar.** The wide
  layout was a row *inside* the stage — orbit view beside the panels — with the timeline and
  the commit bar stacked under the whole width. That arrangement can express no height for
  the panels: the column stretched to the stage and its contents simply carried on past the
  bottom edge, over the Δv slider and **Commit plan** and out of the window, which also gave
  the page a scrollbar it should never have. With the contract panel open (#264) that is the
  ordinary state of C05, not an edge case. The grid is on the planner itself now and the
  panels are one of its columns, running from under the HUD to the bottom of the commit bar,
  so the timeline and the commit bar end where the panels begin and the panels scroll against
  their own column instead of against the document. jsdom has no layout, so what a test can
  hold is the shape the grid places out of — the five regions and their order — and one now
  does.

### Changed
- **The commit bar is one row: undo, redo, *Commit plan*, and §6.4's reasons.** It was three
  stacked blocks, the middle one a full-width list holding a single sentence above a button
  130 px wide — two rows of a screen where the orbit view is already shrinking to keep this
  bar above the fold at 720p, spent on width nothing was using. Nothing is truncated to fit:
  six reasons can be true at once and the longest is 68 characters before §8.9's +40%, so
  the row wraps, and on a phone it becomes three. The reasons keep their association with
  the button by `aria-describedby`, which is by id and not by position, and the list carries
  `role="list"` because laying the items out in a line removes their markers and VoiceOver
  drops the list semantics with them.
- **The node editor is parked in the orbit view's top-right corner instead of following its
  node.** §8.3.5 asked for "anchored to the node" and that is what it did, with three
  consequences that cannot be fixed while the panel moves: the editor's own controls move the
  node, so the panel ran away from the pointer using it — patched for pointer gestures by
  freezing the anchor, which left the keyboard steppers still moving it; it covered the part
  of the trajectory being edited; and anchored low it needed a maximum height and an inner
  scrollbar, which put **Delete** and **Done** behind a scroll. Parked, it is a fixed berth
  aligned with the zoom and recentre controls down the same edge, and it needs no scrolling at
  all in any window tall enough to hold it — the bound remains, because the alternative on a
  short window is the panel painting over the timeline. §8.3.5 is updated to match. The
  anchor the orbit view reports is now a ref rather than state: nothing renders from it, and
  as state it re-rendered the planner on every frame in which the node moved.

## [0.2.0] — 2026-09-07

> **Two of M3's exit criteria were not met at this tag, and this is the record of that.**
>
> §14.1's M3 row asks for *"Contracts 01–07; contract board; medals and par; settings; two
> colour palettes; keyboard-complete planner; Codex entries for Acts I–II; axe clean.
> **Public alpha announced.**"* Everything but the last is shipped and checked below.
>
> Outstanding:
>
> - **§13's eight playtest sessions have not been run** — #209, the M3 round, and #208, the
>   round waived at `v0.1.0` and deferred to run here alongside it. §14.1's own note on that
>   waiver says M3's criteria *"are unchanged and are not waivable by this precedent"*, so
>   this is a second deliberate call rather than the first one continuing.
> - **The public alpha has not been announced** — #278.
>
> What that costs is what it cost at `v0.1.0`, now over seven contracts instead of one:
> the alpha's usability is **unmeasured**, not good or bad, and the first external signal
> will arrive as whatever a player volunteers. Nothing here should be described as
> playtested.

### Added
- **The two teaching surfaces: §8.6's coach marks and §8.3.10's Codex (#159, #160, #161,
  #163).** The game could already be played and could not yet explain itself. Both halves land
  together because they are the same job seen twice — naming an idea at the moment a player
  needs it — and because either alone is a shell: a framework with no content, or content with
  nothing to render it.
  **Coach marks** are anchored, non-modal hints on C01–C04, two per contract. The design
  decision worth knowing about is the **trigger vocabulary**: five named moments — the plan is
  empty, the first node exists, one burn is not going to be enough, the plan would commit, a
  node is selected — evaluated against facts the planner already computes, and *latched*, so a
  mark does not blink out when the player deletes the node that summoned it. A contract still
  declares nothing but catalogue keys, so where a mark points and when it fires are properties
  of the idea rather than of the contract, and adding one is three data edits and no component
  change. FR-902's cap is enforced against the scenario files rather than documented: a fourth
  mark on a contract, a mark on C05, or a declared key with no row in the table each fail
  `tools/content`. Dismissal is two lifetimes — *Got it* for the attempt, *Don't show this one
  again* into `flags.coachMarksSeen`, which has been in the save, validated and unread, since
  #184. The mark is announced politely and **never takes focus**: it appears mid-drag, and a
  hint that stole the gesture would be a modal, which §8.6 says this is not.
  **The Codex** is §8.3.10's four progressively disclosed layers, an index grouped by act, and
  `#/codex/:slug` working from a cold load — into a named layer, via `?layer=numbers`. An unknown
  slug gets §8.7's treatment: what failed, in words, then the index. `C` opens it at the concept
  for the current contract, and does so as an **overlay** rather than a navigation, because
  `usePlanner` holds the plan in component state and routing away would lose it; the route and
  the overlay render the same entry component, so there is no second implementation to keep in
  step. #162's live diagram is M4, so the slot renders a placeholder that says it is one.
  **Seven entries**, one per §6.12 Acts I–II outcome plus C08's, which is an act early because
  #83's debrief diagnosis already linked it and a *read this* that dead-ends is worse than an
  entry arriving before its milestone. Every number in a "the numbers" layer is **computed from
  `@hh/astro`'s constants at module load** and checked against an independent derivation — the
  speeds from conservation of angular momentum and energy at the apsides rather than from
  vis-viva, and the reference orbits read off the contracts, so an entry and the contract it is
  seen in describe the same orbit. Two of those checks are worth naming: the single-burn figure
  agrees with **C03's par to the fourth decimal**, and that par was found by an unrelated
  Lambert grid search through the game's own timeline; and §8.3.10's own printed example —
  92.6 min, 91.3 min, 6 715 km, 274 km, 1.3 min, 5.0° — is **reproduced from the constants**
  rather than copied out of it, which is §7.6's process rule applied in the direction it is
  written.

- **§8.3.1's title screen and §8.3.2's contract board, with §8.7's states behind them
  (#118, #119, #125, #126).** The two screens that turn seven contracts into a game: before
  this the campaign was a set of URLs and `#/` was a placeholder holding a temporary list of
  links. The **title** is now the real screen — wordmark, tagline, §8.2's five entries and the
  footer — and its background is *a genuinely propagated LEO→GEO Hohmann transfer*, built from
  `@hh/astro`'s closed form and stepped by `@hh/sim`'s timeline at ~2 000×. Nothing about it is
  keyframed: the only thing that animates is the scrub epoch, and every frame reads the ship's
  position out of the same propagation a committed plan would use, which is what makes §8.3.1's
  *"the first honesty signal"* a claim the repository can keep — `background.test.ts` re-derives
  both burns from vis-viva independently and checks the arrival lands circular at GEO. It is
  decorative and behaves like it: `aria-hidden`, never focusable, and **stopped entirely** under
  `prefers-reduced-motion` or §8.3.12's background-animation setting, which this is the first
  consumer of. FR-901's two clicks are now counted by a test — **Start goes straight to the C01
  briefing**, not to the board, because §8.3.1 is explicit that there are no menus between a
  stranger and the game.
  The **board** renders acts, cards, medals, locks, `NEXT`, §6.10's career credits and an
  honest daily strip that says what it does not know rather than implying a leaderboard that is
  M7. It contains **no rules**: every gate comes from #82's one `progression()` call, so §6.8's
  ⌈2/3⌉ threshold exists in exactly one place and the board, the title's *Continue* and §8.3.3's
  direct-URL guard cannot disagree. A locked card shows the act and the unlock rule and **never
  the contract title** — the titles are the reveal — and the guard now keeps that promise in the
  screen *heading* too, which was leaking the name over the refusal.
  §8.7's rows arrive with them: a first-load skeleton whose progress bar appears only past
  800 ms and is a delayed CSS animation rather than a timer, a scenario refusal that names the
  failing field and offers a prefilled report, invalid and future-schema replay codes told apart
  because re-copying an intact code from a newer build is a loop with no exit, a
  canvas-unavailable notice carrying §11.15's matrix, and an **error boundary** that turns an
  unhandled throw into a recoverable state instead of a blank document — while still re-throwing
  in development, because a boundary that swallows errors is a boundary that hides bugs.
  Finally, §11.15's **pre-boot capability check** ships inline in `index.html`, written in ES5
  and detecting by feature rather than by `eval` of modern syntax, because a check written in
  the syntax it is testing for cannot run on the browsers it exists for. `CompressionStream` is
  deliberately **not** in the blocking set: §11.15 gives it an `fflate` fallback, and blocking on
  it would lock out players who could play.

- **§8.3.12's settings screen, and everything behind it (#186, #122, #187, #185, #184, #124).**
  FR-704 asks that every setting persist and apply immediately without a reload; before this
  `SaveV1.settings` was `Record<string, SettingValue>` — a deliberate hole in an otherwise
  strictly validated document — and there was no screen to reach it from, so #116's five
  palettes and #173's motion preference were capabilities a player could not use. Settings are
  now a **spec table**: each row carries its key, group, kind, domain, default and labels, and
  is simultaneously what validates a stored block, what renders the controls, and what resets
  them. The screen is a map over that table, which is what makes "every setting in §8.3.12"
  true by construction rather than by review. Storage is **sparse** — an unset setting stores
  nothing and assigning the default removes the key — so a changed default in a later build
  reaches every player who never touched that setting, and an export does not pin today's
  defaults into the file. Settings can no longer make a save unreadable: an unknown key is
  dropped and an out-of-range value falls back, because a typo in a hand-edited settings block
  must not cost somebody their medals. **Keybindings are fully remappable**, resolved through
  `event.key` rather than `event.code` — §8.5.3's map is mnemonic and a mnemonic belongs to the
  character on the keycap, where `event.code` would keep QWERTY's geometry on Dvorak — with
  conflicts detected **per scope**, since a global check would report conflicts on §8.5.3's own
  defaults. A conflict names what it collided with and offers swap or cancel; nothing is bound
  silently over anything. Export, import and clear are §11.7's only "cloud save", and their
  confirmations state what is at stake in contracts finished and medals held rather than asking
  an abstract "are you sure", with export offered from inside the confirmation. **A browser
  that will not store now says so** (FR-702): a non-blocking notice at load for storage that is
  unavailable, one at the moment of a failed write for a quota that ran out, both offering the
  export that is the only recovery either state has — read from the in-memory save, which is
  what makes it work at all. And **`?` opens the keyboard help overlay** from anywhere, showing
  the *current* bindings rather than the defaults, grouped by scope with the screen you are on
  first. Two things are stored and honestly inert rather than faked: audio, which has no
  playback until M4, and the light theme, which needs five more palettes and the §8.8 contrast
  matrix that validates them. Settings renders **over** the screen it was opened from, so
  adjusting the palette mid-plan does not cost you the plan.
- **§8.5.3's keyboard map, complete and scoped by screen (#141).** The map was a `switch` over
  `event.key` covering the planner, and §8.3.12 makes every binding remappable — a switch has
  to be *rewritten* to re-key where a table only has to be re-keyed. It is now `BINDINGS`, an
  array carrying each binding's keys, the screens it applies on, a stable id independent of
  its key, and a description; the map the handler runs, the map #187 will re-key and the map
  #124 will render are the same array rather than three that agree today. Scoping is what
  makes one table possible: `S` is *skip to end* during execution and nothing in the planner,
  and `Enter` commits a plan and accepts a briefing. Execution's four bindings and the orbit
  view's three camera keys were comparing `event.key` in their own components and are now
  rows like the rest — NFR-016's guarantee cannot hold for keys that live outside the map.
  `?` and `C` are listed with their features unbuilt, resolving to nothing but visible to the
  overlay and the remapper, because a binding missing from the table is one neither can offer.
  §8.8's skip-to-content link is present on every screen and targets the same heading a route
  change focuses. And **§13.5's E4 runs as a test**: C02 played from briefing to debrief on key
  events alone, with every pointer constructor and `HTMLElement.click` replaced by a throw for
  the duration — so a walkthrough that quietly reached for a pointer fails rather than passing
  for the wrong reason, which counting dispatches afterwards would not have caught.
- **The contract stays readable while planning (#264).** ACCEPT is a one-way door: §8.3.3 states
  the job in numbers and the planner then showed the Δv budget and the deadline and **nothing
  else** — not the objective, not par, not the constraints, not the target's setup. Tolerable
  while one contract shipped; a real problem for Acts I–II, where C07's objective is three
  numbers none of which the planner displayed and all of which are needed to plan the burn.
  There is now a contract panel: a fourth entry in the strip that already carries the plan, the
  readouts and the assists, toggled from a control beside `?` and `⚙` or with `B`, and open or
  closed for the rest of the session rather than per contract. It renders the **briefing's own
  content, from the briefing's own code** — `objectiveLine`, `setupLine`, the constraint rows
  and the `Quantity` component that carries display units with SI behind them all moved to a
  shared module both screens call, and a test asserts the two render identical text for the
  same scenario. A second rendering would have been two things to keep in step, and the first
  to drift would be the planner's, the one a player sees least. Opening it changes nothing —
  not the plan, the scrub head, the selection or playback — which is structural rather than
  asserted: the component takes a scenario and a catalogue and no callback that could edit
  anything. Found by playing the shipped Acts I–II build, not by a test.
- **Constraint bands now warn before they fire (#129).** §6.5 says *"a player never discovers a
  constraint by failing it"*, and the timeline drew bands only for intervals the current plan
  was **already violating** — which is the second half of that sentence and not the first. The
  deadline's region is the clearest case: every epoch past the wall is one where a burn is
  `L3`, it is exactly computable from the contract, and nothing shaded it until a plan crossed
  it. It is a band now, and C03 has three hours of it. Bands are built from the constraint
  *evaluations* rather than from the legality reason list, which had tied what was drawn to
  what was blocking — the burn-count cap is soft and raises no reason by design, so it could
  never be banded at all. A preview band is shaded and a violation is solid (§8.6), each
  carries its own sentence naming the constraint and its interval so the shading is never the
  only channel (NFR-019, §8.8), and the wording differs rather than being the same sentence
  with a word changed. §6.6's `constraints` assist turns the previews off — and deliberately
  leaves violations reported, because turning off an assist that shows you things *early*
  should not leave the commit bar calling a plan illegal with nothing saying where.
  `constraint-bands.ts` carries a single table mapping every `ConstraintKind` to its timeline
  and orbit representation, including "none, and here is why", so a constraint added to the
  union is a compile error rather than a kind that silently has neither.
- **§8.3.4's assist tray, complete (#140).** Every assist §6.6 lists, with a name, a one-line
  description, its state, its §6.6 default, and — FR-411's requirement — **its medal effect
  with the right direction**. The three effects are not symmetric and the tray does not
  pretend they are: two assists affect a medal by being *enabled* and two by being
  *disabled*, so a uniform "affects medals" badge would be wrong about half of them and
  would tell a player that leaving the defaults alone costs something, when §6.7's Clean Job
  is specifically available to a player using every default. The current cap is shown as a
  medal rather than a warning icon, and sits **outside** the disclosure so it is legible
  while the tray is collapsed — it is the consequence of what is inside. Trajectory
  prediction appears as a row that is not a control, with its reason, because §6.6 lists it
  as "on, cannot be disabled" and a player who cannot find it will assume it is hidden
  somewhere. An assist the contract does not allow is **absent**, not dimmed: §6.6's unlock
  is progression rather than purchase. The rendered set is generated from #81's model, and
  the test asserts it against that model rather than against a literal list, so an assist
  added upstream cannot silently fail to appear.
- **Undo and redo over plan edits (#138).** FR-110's fifty deep, `Ctrl+Z` / `Ctrl+Shift+Z`, and
  the `⟲ UNDO` / `⟳ REDO` controls §8.3.4's commit bar had already reserved space for. Every
  accepted mutation — add, move, delete, Δv change, snap, context-menu action — is exactly one
  entry, and **one drag is one entry however many pointer events it produced**, which is
  structural rather than something to be careful about: the plan is not touched until the drag
  is released, so a release is the only place a drag can record. A refused edit (`L5`) records
  nothing and does not clear the redo stack, because §6.11 counts mutations and a refusal
  mutated nothing. An entry carries the plan, the selection and the node editor's target, so
  undo does not strand a player looking at an overlay for a node the restored plan does not
  contain — but **not the scrub head**: FR-403 makes scrubbing a view operation, and an
  undoable scrub would make `Ctrl+Z` appear to do nothing after a player had merely looked
  around. The reducer lives in `@hh/ui` beside §8.5.1's machine, holds two stacks and no
  present of its own — the planner's state is the present, and a second copy of the plan would
  immediately raise the question of which is authoritative — and is tested as plain values,
  which is what makes §13.5's E7 assertable by canonical JSON rather than by driving a screen.
- **DEP-07's snap now applies to every gesture that places a burn (#136).** `releaseDragging`
  called `moveNode` with the raw dragged tick while `addNodeAt` snapped, so a node placed by
  clicking landed on the apsis and the same node dragged one pixel came off it — the exact
  failure DEP-07's own docstring warns about, *"the kind of rule players correctly experience
  as the game being unreliable"*. The drag now snaps **during** the gesture rather than on
  release, so the preview already shows where the burn will land and there is no jump when the
  pointer is let go. §8.3.5's epoch slider snaps too; the numeric MET fields deliberately do
  not, because a typed number is a statement and a dragged slider is a gesture.
- **Keyboard nudges snap, and can escape (#136).** `,` and `.` go through a new `snapNudge`,
  which accepts a snap only when it carries the node **further in the direction the player
  pushed it**. Without that rule a node on an apsis is pinned there — the snap finds the same
  apsis a second away and puts it straight back, so `.` does nothing however many times it is
  pressed. Phrasing the rule as "ignore the apsis we are on" fixes only the first press: a node
  one second past an apsis is not on it, so the second press snaps back and the node
  oscillates. The direction test is one comparison and covers both.
- **§8.5.2's node context menu (#136).** Delete, snap to periapsis, snap to apoapsis and zero
  Δv — none of which had a single home before: delete was on the row and on `Delete`, the two
  snaps were only inside §8.3.5's overlay, and zero Δv existed nowhere. Right-click on desktop,
  §8.5.4's long-press on touch, a control on every plan row, and `ContextMenu` or `Shift+F10`
  from the keyboard. On a near-circular orbit the snap entries are **disabled with a reason**
  rather than hidden: every Act I contract starts on one, so that is the first thing a player
  meets, and a menu whose entries come and go teaches them the game is inconsistent where a
  dimmed entry saying "this orbit is circular — it has no apsides" teaches them something true.
- **A snapped burn is marked as snapped (#136).** In the plan panel's row, as a caret in the
  epoch cell and as words in the sentence a screen reader is given (NFR-019). Derived from the
  geometry through `apsisAt` rather than from a flag set when the snap happened — a flag would
  have to be cleared every time the node moved for any other reason, and the first one missed
  would leave a node claiming to be on an apsis it had left.
- **Acts I and II, as playable content (#90, #92, #93, #94).** Six new contracts — C01
  *Shakedown*, C02 *Round Trip*, C04 *Long Haul*, C05 *Tailgate*, C06 *Overtake* and C07
  *Slot Machine* — with computed pars, reference replays and briefs. Act I reproduces
  §6.8's figures to the digit; Act II's Δv values are **half** §6.8's for C05 and C06,
  because those are `intercept` contracts and DEP-04 asks for range and not for relative
  velocity, so the re-circularisation §6.8 prices is not bought. `docs/PARS.md` records
  every divergence and its cause.
- **§6.5's burn-count cap (#92).** A soft constraint, first used by C04: declarable in a
  scenario, evaluated during planning, shown in the briefing and the HUD, and never able
  to block a commit. Exceeding it forfeits Gold through §6.7's existing
  `burns ≤ par_burns` rule rather than through a second threshold — there is no fourth
  legality code and none was added.
- **Two more par-solver families (#90, #93, #94).** `reach_orbit` gets closed-form
  tangential transfers, with the departure epoch swept only when the goal has an apse line
  to orient; `station` gets drift orbits indexed by revolution count; and `intercept` gains
  a **phasing** family alongside its Lambert search, because a phasing solution departs and
  arrives at the same position — the one geometry Lambert's problem is degenerate at, and
  one the transfer search was answering 34% too expensively.

- **One focus policy, and axe-core as a blocking gate (#169, #170).** M3 added four screens
  and five overlays, and each one was an opportunity to strand a keyboard user. `a11y/overlay.ts`
  is now the single statement of what an overlay owes one, and it names **three** kinds rather
  than assuming every overlay is a dialog: modal (focus in, trapped, `Esc` closes, focus
  returned), non-modal (focus in and returned, never trapped, and `Esc` belongs to the screen
  that can order it against everything else it has open), and announce-only — a coach mark,
  which takes no focus at all. The distinction is spelled in the *type*: a non-modal overlay
  has no `onClose` to pass, so wiring `Esc` into one does not compile. Every overlay in the
  app now uses it, and a census over the sources fails the build if a component declares an
  overlay role without it.
  The half that actually strands people is restoring focus when the opener has *gone* — the
  node editor closed by deleting the node whose row opened it. That took a measurement rather
  than an argument: at the moment the overlay is torn down the opener is **still attached**,
  so the obvious `isConnected` check passes, focus moves to the row, and Preact removes the
  row a few lines later in the same commit. Focus lands on `<body>` with everything having
  reported success. `restoreFocus` therefore re-checks once the commit has settled and sends
  focus to the screen heading if it came to rest nowhere. Phase changes within a contract
  (`briefing → planner → execution → debrief`) now move focus like the route changes they are
  to the player, using the scope the contract screen already reports upward.
  **axe-core runs in CI over every route and every state**, blocking on serious and critical.
  The route list is derived from the router's own table as a `Record<RouteName, string>`, so a
  new route is covered by default and a deleted one is a compile error; the four phases, all
  six overlays and the failure states are visited as states. **`color-contrast` is disabled by
  name**, because jsdom has no layout and the rule would otherwise report zero violations for
  a check that never executed — a gate implying coverage it does not have, which is the failure
  `docs/PHYSICS.md` already has a rule about. Its replacement is named in the same place:
  #116's contrast matrix, which covers all five palettes rather than the one on screen. Every
  route is clean at merge and nothing is suppressed. The stylesheet gained a matching gate:
  a rule may not suppress the focus ring without drawing one another way.

### Fixed
- **Twelve bugs found by exploratory testing of the built app (#265–#276).** Driven through
  the Playwright MCP server against the preview build rather than read out of the code, and
  worth recording as a group because of *why* the suite was green throughout: jsdom has no
  layout, so nothing that overflows a viewport can fail a test there, and no user-agent
  stylesheet, so an unstyled button computes the same either way. The two worst were found
  by clicking.

  **A coach mark covered *Commit plan* and swallowed its clicks (#272).** The first mark a
  new player sees is anchored to the orbit view, which reaches to within 8 px of the
  timeline, so "under the anchor" was exactly on top of the commit bar — `elementFromPoint`
  at the button's centre returned the card's *More in the Codex* button. A first-time player
  with a legal plan could not fly it. Placement now tries four positions and takes the first
  that covers no control; the first attempt at the fix reserved the commit bar *by name* and
  merely moved the problem onto the HUD, which is why the rule is stated as what it is.

  **The frame never fitted the viewport (#265, #268, #269).** `body` carried
  `min-height: 100vh`, but `#app` and `main` were plain blocks, so the screen heading's
  `margin-block-start` collapsed out through both and applied *outside* that box: every route
  was ~21 px too tall, including ones whose content fitted easily. `#app` is a flex column of
  exactly `100dvh` now — flex stops the collapse, and the definite height is what lets a
  `flex: 1` child resolve against the window instead of its own content. That is what let the
  planner's orbit view shrink to bring **Commit plan** back on screen at 1280×720 and 1366×768,
  where it had been entirely below the fold, and what stopped the title screen's canvas sizing
  the grid row that was supposed to be sizing it.

  **Buttons rendered as browser chrome (#267).** There was no bare `button` rule; the four
  scoped ones mostly set padding without clearing the user-agent defaults, so **Accept**,
  **Commit plan**, 36 of Settings' 37 controls and the help affordance on all twelve routes
  drew Chrome's `2px outset` bevel. It was the same grey in all five palettes, so a third of
  the interactive surface did not respond to §8.3.12's colour setting at all.

  **Two readings of one node disagreed (#270).** `editorSnappedTo` compared
  `snapToNamedApsis(...) === node.epoch` exactly; a snapped epoch is quantised at node
  construction (FR-105) and the finder's is not, so the editor reported every snapped node as
  *free* while the plan row beside it drew the apsis caret. `apsisAt`'s docstring names that
  exact trap, and both readings come from it now.

  **A typed epoch past the horizon threw (#271).** `requireNodesWithinHorizon` fired inside
  `apply`'s `setState` updater and escaped through Preact's render; the node stayed put only
  because the update aborted, and the field kept the rejected value so every later edit threw
  again. `nudgeEpochBy` twenty lines away had clamped against exactly this since it was
  written. Typed entry now refuses out-of-window input the way §8.3.5 asks — *"previous value
  restored, never silently clamped"* — with a clamp behind it.

  And four that pointed nowhere: the debrief's **Next contract** was hardcoded disabled from
  M2 and told every player C01 was the last contract in a build with seven (#273); the title's
  **Codex** entry linked to a slug no entry has (#274); the footer specified for *"every
  screen"* was on two of twelve, so the planner and execution carried no version (#275); every
  Codex entry printed its title twice (#276); and there was no favicon, which made a 404 the
  only console error on a clean load (#266).

- **Coach marks were two flags pretending to be one (#159).** §8.3.12's Gameplay group carried
  a `gameplay.coachMarks` boolean and §6.6 carried the `coach_marks` assist, and nothing tied
  them together: turning marks off in Settings and turning them off in the assist tray were
  different acts with different results, which is exactly what #159 forbids. The assist bit
  wins, because §11.6 freezes the mask's order and a replay code records it; the boolean is
  gone. No migration — settings are sparse and an unrecognised key was already dropped, so a
  save written by an earlier build simply forgets a value that never had a second reader.

### Changed
- **The contract registry reports a refused scenario instead of throwing (#125).** It used to
  throw at module load, so that a bad contract was a build failure rather than a board with a
  silent hole in it. The first half of that is still enforced — by `tools/content/`, which
  refuses to let an invalid contract merge and fails in CI with the file named, which is a
  better place for it than a browser with a blank page. What the throw could not do was §8.7's
  row: it happened before anything was mounted, and stringifying `parseScenario`'s JSON pointers
  into an `Error` threw away the field-level detail FR-202 exists to produce. The hole is no
  longer silent either way — a contract that failed to parse is now *visible on the board as a
  failure* rather than absent from it.
- **The debrief can explain a missed `station` run (#94).** `diagnosis.ts` handled
  `reach_orbit` and the three proximity kinds and returned nothing for a slot, so C07 —
  the only `station` contract in v1.0 — was the one contract whose failures the game could
  not account for. Two rules now: still drifting, and stopped in the wrong place. They
  want opposite corrections, so they read different quantities, and the drift rule reads
  the orbit the plan **ends** on rather than the best moment it managed — a plan with one
  burn has an admissible-drift instant before it ever leaves geostationary, and reading
  that would tell a player they had stopped while they slid away.
- **A `reach_orbit` goal may omit `raan_rad` and `argp_rad`.** A circular goal has no apse
  line and an equatorial one no node line, and every v1.0 contract is equatorial-equivalent,
  so requiring an author to state an orientation their goal does not have was asking them to
  write down a requirement the evaluator then ignores. The loader refuses a document that
  omits one its own goal *does* make meaningful, which would otherwise silently demand an
  orientation nobody wrote.
- **Par now requires the objective to be met inside the deadline.** §6.7's Bronze is
  "objective met, within budget and deadline", so a par that earns no medal is not a par.
  `L3` caps the last *burn* and a one-impulse plan's only burn is at departure, so nothing
  else was enforcing this — and a search whose cost falls with time walked straight to the
  planning horizon because of it.
- **The Lambert revolution ceiling is derived from each contract's horizon** rather than
  fixed at four, so §6.8's eight-revolution phasing contracts get eight without any
  per-contract override. C03's par is unchanged in every digit.

- **§6.4's fifth objective type, `station` (#77).** Mean longitude within a slot and secular
  drift within a limit, both at once. The slot is stated as an offset from the ship's own
  starting longitude, because Earth's absolute orientation is not modelled — the sidereal
  angle at J2000 is an ephemeris fact this game does not claim to know, and the unknown
  constant cancels in a difference. Drift comes from the orbit's mean motion against
  Earth's rotation rate, never from differencing longitude samples: a slightly eccentric
  geostationary orbit librates by about `2e` radians, which at `e = 1e-4` is larger than
  the entire drift budget and would be read as drift.
- **§6.6's assist model (#81).** The seven toggleable assists, what each does to a medal,
  and the two things §6.7 derives from them — Clean Job eligibility and the medal cap. The
  effects are deliberately asymmetric: two assists affect a medal by being *enabled* and
  two by being *disabled*, so the direction is part of the effect rather than a uniform
  "affects medals" flag. §11.6's assist bitmask now records what a run actually used, with
  a frozen bit order and an unknown high bit refused rather than ignored.
- **§6.8's progression (#82).** Which contracts are open, act completion counts, and
  §8.3.2's `NEXT` marker. The threshold counts the contracts *shipped*, so releasing Acts
  I–II cannot lock Act III behind contracts that do not exist; Bronze is a floor rather
  than an equality, so a save full of Golds unlocks everything.
- **§8.3.9's diagnosis rule set (#83).** The debrief now says *why* a run missed, from five
  ordered rules over the outcome — and says nothing when the evidence is ambiguous, which
  is §8.3.9's own rule. Telling the two geometric cases apart needed the miss decomposed in
  the ship's RTN frame: the same 12 km is either a ship on the right path arriving ninety
  seconds late, or a ship at the right moment twelve kilometres too high, and those want
  opposite advice.
- **§9.2's design tokens, in five palettes (#116).** Thirteen tokens — ground, text, the
  five meaning colours, Earth, hazard, grid — defined once in `@hh/ui` for the default,
  deuteranopia, protanopia, tritanopia and high-contrast palettes, and resolved by
  `apps/web` for the DOM *and* the canvas from the same source. Before this there were two
  palettes: some thirty hex codes in `app.css` and fourteen more in `planner/colours.ts`,
  with nothing making them agree. The scene needs fourteen inks from thirteen roles —
  Earth's disc, its coastline and its night side are all `--earth` — so the extra ones are
  **derived** rather than hand-written per palette, which is what keeps a sixth palette a
  thirteen-value change. Contrast is checked in CI over an explicit list of the pairs the
  interface actually draws, at §8.8's 4.5:1 for text and 3:1 for lines, in all five.
- **The icon set (#176).** Fifteen hand-drawn inline SVG glyphs on one 24-unit grid, in
  `currentColor`, with no icon font and no third-party source. Every glyph has a consumer:
  the ones §8.3 implies for screens that do not exist yet arrive with those screens, because
  a glyph nothing renders has no test that can tell it from a broken one. An icon is
  `aria-hidden` by default and an image only when given a label, so being the *only* thing
  a control says takes a deliberate act — and the planner sweeps every button to prove none
  of them is.
- **`prefers-reduced-motion` resolved from three states (#173).** `system`, `on` or `off`,
  because §8.3.12's setting has to override the system query in both directions. The
  debrief's medal reveal is the one row of §9.4's table that does not collapse to zero: it
  becomes a cross-fade, since it is the game's only moment of ceremony and removing it
  would take away a signal rather than an ornament.

### Changed
- **Medals now reflect the assists actually enabled (FR-301).** `v0.1.0` passed a
  hard-coded eligibility flag and an assist mask of zero, because the model behind them did
  not exist yet. With §6.6's defaults a Gold run is a Clean Job; enabling a capping assist
  caps the run at Silver and the debrief can say which one.
- **Maneuver nodes are drawn in `--plan`, and selection is a ring in `--accent`.** §9.2
  assigns *"planned trajectory, nodes"* to one token and §9.3 separates a node from the
  path it sits on by shape — a diamond with a handle cross against a run of dots — rather
  than by hue. The amber node and the second amber for selection were M2 placeholders that
  predated the palette.
- **Panel borders are visible.** §9.2 describes `--grid` as *"20%"*, which measures about
  1.2:1 against the console ground; §8.8 requires 3:1 on UI boundaries. Where a descriptive
  column and a numbered requirement disagree, the requirement wins.
- **The orbit-scene harness draws what the planner draws**, and gained a palette selector.
  It had been carrying a stale copy of the M2 colours and a hand-mixed grey ramp; its
  greyscale toggle is now derived by luminance from whichever palette is selected, so
  §8.3.4's fifth principle is checkable in all five rather than in one.

## [0.1.0] — 2026-09-05

**The vertical slice.** One contract, `c03-cold-open`, playable end to end: briefing →
planner → commit → execution → debrief, on real two-body physics validated against
Curtis, Vallado and a `hapsira` fixture.

> **M2's exit criteria are met except one, and it was waived rather than satisfied.**
> §14.1 asks for "5 playtest sessions run and reported"; **0 of 5 have been run.** The
> round is prepared — protocol, consent form and observation sheet are written and the
> build under test reports its own identity — and it is deferred rather than cancelled.
> Recorded here because a release that quietly drops an exit criterion teaches the next
> milestone that criteria are optional. See §14.1's M2 row and `docs/PLAYTEST-M2.md`.

### Added
- **Execution — playback of the solved timeline (#144, #145).** Committing a plan now flies it.
  Five rates from `1×` to FR-602's `100 000×`, `Space` to pause, `S` to skip to the end and
  `Esc` to abort back to the planner with the plan, the scrub head and the selection all
  restored. Playback is a **display** rate over an already-solved timeline: the speed appears in
  one expression — how far the epoch moves per wall-clock second — and every event comes from an
  array built before the first frame, so changing rate mid-run cannot change the result. A long
  frame jumps the epoch and drains every event it passed rather than iterating a fixed timestep,
  which is what makes a 500 ms stall at 10 000× skip and duplicate nothing. **Skipping to the end
  is `advance` with an infinite step**, so it is not a second code path that could drift from
  watching — it is the same one.
- **The flight log (#146).** Every burn, apsis, revolution, constraint entry and exit and the
  closest approach, with epochs, built once from the solved timeline by the event finders rather
  than sampled as the run plays — so it does not depend on the frame rate, the speed, or whether
  anyone watched. A DOM list, one focus stop, scrollable, and **not** a live region: the record is
  complete and the *narration* beside it is bounded to at most three entries plus a count per
  step, which is what keeps a screen reader from being handed forty apsides in one frame at
  10 000×.
- **The debrief (#121), in both of §8.3.9's variants.** Success renders §6.7's medal by name as
  well as by colour, the YOU / PAR / YOUR BEST table with signed percentage deltas, and the
  encounter against the tolerance it was judged by. Failure replaces the result block with the
  closest approach achieved, what was needed and the Δv used. RETRY restores the plan, SHARE
  copies the run's §11.6 replay code, BOARD returns to the contract list, and NEXT is present and
  disabled with the reason, because this build ships one contract. Beating `par_dv` is treated as
  D12 says it should be: the debrief says our optimum was wrong and offers a prefilled `physics`
  report carrying the replay code.
- **Medals and the outcome (§6.7, FR-301, FR-304).** Bronze, Silver, Gold and Clean Job, evaluated
  on §11.4's scoring grid — Δv to 0.1 m/s and time to 1 s — so a 1e-9 difference between JavaScript
  engines can never flip one. Bronze's *"within budget and deadline"* is now actually checked:
  `L3` caps the last **burn** and `L6` asks about the whole **horizon**, so a run that intercepted
  twenty minutes after the deadline previously passed both and is now its own failure, with its
  own explanation.
- **The playback camera (#147).** Follows the ship with the target framed, as a pure function of
  the playback epoch — no wall-clock ease, which at 10 000× would spend the run chasing a ship
  that left before it started moving, and no 20% re-frame threshold, which would jump at whatever
  rate the speed produced. Smoothing is the *window* the framing is computed over, measured in
  mission seconds; the window closes continuously as the encounter approaches, so "far apart
  early" becomes "metres apart at closest approach" with no regime change to be jarred by. Manual
  pan and zoom suspend it until ⌖, and none of it can touch the outcome.
- **Completed runs are recorded (FR-302).** Best medal, best Δv, best time, burn count and the
  best run's replay code, per contract, best-not-last — so the debrief's YOUR BEST column has
  something to compare against on the second attempt.
- **`findRevolutions` in `@hh/propagation`.** FR-604 asks the flight log for revolutions and the
  five existing finders do not provide them; counting periapsis passages would report nothing at
  all for the near-circular orbits every v1.0 contract flies. Closed-form, anchored to the arc's
  own start rather than to periapsis, indexed rather than accumulated, and validated against the
  DOP853 oracle: at a returned epoch an independent integrator started from the arc's state must
  arrive back at it.

### Added
- **The build says what it is (§14.4).** The debrief prints `Build 0.0.0 (ae569e9)` — the app's
  semver and the short commit SHA, injected at build time by `vite.config.ts` and exposed by
  `apps/web/src/version.ts`. §14.4 asks for the version to be visible on the title screen and in
  the debrief; the title screen is #118, so this is the half that exists, and the debrief is the
  better half anyway — it is where a player who has just seen something wrong is closest to
  reporting it, and the beat-par block beside it already offers a prefilled `physics` issue.
  **The SHA is there because the version does not move between releases** and "which build is
  this" is the question actually being asked: `docs/PLAYTEST-M2.md` answered it by reading the
  entry script's content hash out of the deployed HTML and copying it into a table by hand, which
  went stale within a day. Its round now records what the screen reports instead. The version has
  one home, the root `package.json`; `apps/web`'s is private and unused, because two numbers that
  can disagree eventually do. The identifier is deliberately **not** a catalogue string — it is
  read back verbatim into bug reports, so there is nothing in it to translate.

### Fixed
- **A dragged node follows the pointer for the whole gesture, not just its first move (#263).**
  Two faults behind one symptom, both found by driving the built app rather than by a test. The
  reference epoch `pickEpoch` uses to tell one revolution from another was re-derived per move
  by looking the node up in the drawn timeline — but the drawn timeline is the drag *preview*,
  so the moment the first move landed, the node's epoch and therefore its derived id had
  changed and the lookup missed. The reference silently fell back to the scrub head, which is
  a different pass, and the burn jumped back towards T+0 on the second move of every drag. It
  is captured once now, at `pointerdown`. And the plan panel showed the pre-drag numbers for
  the whole gesture and only caught up on release, because the plan is deliberately not
  mutated until then; it now renders the gesture's live values, which is what §8.8's
  canvas-parity rule asks for — the orbit view already had them.
- **Dragging a maneuver node works again (#263).** It did nothing in `v0.1.0`, deployed: the node
  selected on press and then stayed exactly where it was however far the pointer travelled, and the
  Δv handles behaved the same way. §8.5.2 makes dragging the primary way a burn is placed and moved,
  so the released build was missing its main verb. The gesture was held in a local of the effect
  that installs the pointer handlers, and `onPointerDown` calls `onSelectNode` — which changed a
  value in that effect's dependency array, so the effect re-ran *between* `pointerdown` and the
  first `pointermove` and the new closure's gesture was `null`. The gesture now lives in a ref, and
  the listener effect's dependencies went from twenty-one to three, so a scrub tick or a drag frame
  no longer destroys and rebuilds the renderer, the tessellation cache, the hit index and seven
  listeners. The pointer handlers are installed **once at mount and never again during a drag**;
  before, it was once per pointer event. Nothing in CI could have caught this, because there was no
  pointer-drag test in the repository at all — #134 and #135 closed on `pick.ts` unit tests and on
  the keyboard paths, both of which bypass the effect that owns the listeners. There is one now, and
  it fails against the old code.
- **The ship and the target now move.** Both markers were drawn at a fixed offset along their
  opening orbit and stayed there — through a scrub of the planner's timeline, and through an
  entire playback run. `MarkerSpec.offsetSeconds` is *where a body is* ("seconds from the arc's
  start to the scrub epoch"), and both views were passing `MARKER_TRAIL_SECONDS = 900`, a constant
  whose own docstring called it *"how far ahead of a marker its motion trail is drawn"*. Two
  different quantities, and the marker got the wrong one. The orbits, the trails and the
  closest-approach tie line all moved correctly around two stationary glyphs, which is why it read
  as the markers being broken rather than as the epoch never arriving. The offset is now the epoch
  being drawn — the scrub head in the planner, the playback epoch during a run — and for the ship
  it is measured from **the arc the epoch lands on**, so a marker no longer sits on the parking
  orbit for the rest of a run after the first burn. `shipMarkerOf` spells that once for both views.
- **The first node of a plan can be placed with the pointer (FR-405).** §8.5.2 places a node by
  clicking the trajectory, and `buildScene` registered a hit target for every arc *except arc 0* —
  the orbit the ship is on now, which was drawn and then skipped. With a plan already in progress
  this is invisible, because arcs 1…n cover the same pixels; on the **empty plan** arc 0 is the
  only arc there is, so the first burn of every contract could not be placed by clicking at all
  while the second one could. Arc 0 is now a hit target. Its drawing is unchanged: it keeps §9.3's
  current-orbit stroke and does not become planned dots.
- **The node editor is readable, and no longer scrolls sideways.** Two faults in one panel. The
  overlay set a near-black panel fill and no foreground, so it inherited the document's black text
  and painted black on `#0a0e17`; its `<input>`s meanwhile rendered in the browser's light-mode
  skin, white boxes on a dark panel. And its Δv rows demanded 369 px inside a 300 px content box —
  a flex item's automatic minimum size is its min-content width, so the label refused to shrink
  below its text plus a number input's intrinsic width, whatever the input itself was allowed to
  do. The panel is 360 px wide, the `min-width: 0` chain is unbroken from the fieldset down, the
  snap radios wrap, and `overflow-x` is `hidden` rather than `auto`: a panel that can scroll
  sideways is one whose layout has already failed, and `auto` hides the failure instead of showing
  it.
- **Full-precision readouts are legible.** FR-406's reveal-on-hover had the same defect as the
  editor and was harder to notice: `.hh-value__precise` set the panel fill without an ink, so
  every tooltip on the planner was black text on a near-black box — present in the accessible
  tree, invisible on screen. Seven of them.
- **The node editor stays under the pointer while it is being used.** §8.3.5 anchors the overlay to
  its node, and the overlay's own controls move that node — so dragging the epoch slider dragged
  the panel out from under the finger holding it. Measured: T+0 to T+40m moved the slider 348 px
  across the stage and 75 px down, several times its own length, so the thumb was released almost
  immediately and the drag could not be completed. The anchor is now suspended while a pointer is
  held down inside the overlay and resumes on release — not while it is merely open, because
  following the node is the specified behaviour and is right whenever the node moves for a reason
  outside the panel.

### Changed
- **D9 is decided, and amended: Preact stays, `@preact/signals` is dropped (#248).** M2's last
  exit criterion besides the playtest round. The HUD was measured in a browser during execution
  playback — the case D9's claim is actually about — at **0.285 ms/frame at 1× and 0.420 ms at
  10 000×**, against §16 R11's 2 ms trigger, with zero frames dropped at any speed and the whole
  frame using 8% of a 60 Hz budget at its worst. R11 does not fire and `preact/compat` is not
  needed. The measurement also settled a question that had to come first: **`@preact/signals` was
  a declared dependency that nothing imported and the bundle never contained** — the slice holds
  its run state in a root `useState` and re-renders the whole subtree every frame, which is the
  opposite of the "without re-rendering panels" the dependency was carried for. It is removed;
  no shipped byte changes, because it was already tree-shaken out. The claim it existed to serve
  is false here — re-rendering the whole subtree costs a fifth of a millisecond. `docs/DECISION-D9.md`
  records the numbers, the probe, and what is still unmeasured; §5's D9 row, §14.1's M2 row and
  §16's R11 are updated. The tail is the part to keep watching: the worst frame at 10 000× is
  1.30 ms, 65% of the trigger, and M3 stacks the board, settings and medals on top of it.
- **How a release is cut is written down.** `CLAUDE.md` gains a *Cutting a release* section. There
  was no process at all — no `git tag` or `gh release` anywhere in the repo, no workflow reacting
  to a tag, and zero tags and zero releases in existence — while §14.4 puts the app on semver and
  §14.1 attaches a version to every milestone. The section says what a release *is* here (a tag
  plus a GitHub release, and nothing else), and the thing that surprises people: **the tag does
  not deploy.** `deploy.yml` runs on CI succeeding on `main`, so the site is live before the tag
  exists; tagging records which commit was the release rather than causing one. No release
  workflow was added, because there is nothing left for a tag to trigger — §11.13's other two
  jobs are the Worker (M7) and publishing the scenario schema, which `vite.config.ts` already
  emits on every build. The section also says to check §14.1's *criteria* rather than the
  milestone's issue list, which at M2 are not the same thing.
- **The M2 playtest round stops hand-pinning its build.** `docs/PLAYTEST-M2.md` named a SHA and an
  entry script that were correct when it was written and wrong the next day, once #249 deployed.
  No session had run, so nothing was measured against the stale pin — but a pin needing a manual
  update after every deploy is one that will be wrong at the moment it matters. The round and the
  observation sheet now record the `Build` line off the debrief instead.

- **The application declares its own ground.** `app.css` described itself as "structure and motion,
  not the look" while carrying some thirty hex codes chosen against a dark field — but never set a
  background or a foreground, so the page took the browser's white ground and black text and every
  one of those dark surfaces painted black on black. It now defines four of §9.2's tokens (`--bg`,
  `--bg-panel`, `--fg`, `--fg-dim`) and `color-scheme: dark`, which is what stops form controls
  rendering light-mode inside dark panels. `--bg` is `SCENE_COLOURS.background` exactly, so the
  canvas has no seam against the page. This is the *ground*, not the palette: #116 still owns
  §9.2's thirteen tokens and all five palettes, and replaces these values without anything outside
  that block changing. The stylesheet's header no longer claims otherwise.

- **A planner restored from a run starts in `EVALUATED`.** Aborting or retrying seeds the planner
  with the committed plan, and §8.5.1 reaches `COMMITTED` only from `EVALUATED` — so leaving it
  `IDLE` rendered an enabled Commit button that did nothing. It is also simply the true state: the
  plan has been evaluated, which is what `EVALUATED` means.
- **DEP-05 and DEP-12 are implemented**, and move from `planned` to `active` in the departures
  registry and in `docs/PHYSICS.md`.

- **The planner (#103, #123, #127, #128, #130, #131, #132, #143).** §8.3.4's five regions — HUD
  bar, timeline, plan panel, readouts and assist tray — around the orbit view, in one component
  tree at every width. The wide arrangement is a grid and the narrow one a tab strip, but the
  panels are the *same instances* at both, so rotating a phone cannot unmount them and take the
  plan, the selection or the scrub position with it. The timeline sits outside the tab strip in
  both, as §8.3.4 requires.
- **§8.5.1's state machine, with illegal transitions that do not compile (#143).** One function
  per edge, each taking the states that edge legally leaves, so `releaseDrag(IDLE)` is a type
  error rather than a run-time no-op. COMMITTED is reachable only with a `Legality` the caller has
  narrowed to `commitAllowed: true`, which makes §6.4's gate the reason the call compiles rather
  than a condition inside it. SCRUBBING is orthogonal — a field, not a phase — and `scrubTo`
  returns the same `plan` object it was handed, so FR-403's "never mutates the plan" is asserted
  by reference identity.
- **Auto-framing driven from application state (#103).** Manual pan or zoom suspends it until the
  ⌖ recentre, the ease runs against the caller's clock over `REFRAME_DURATION_SECONDS` with a long
  frame landing exactly on the target rather than overshooting, and `prefers-reduced-motion`
  collapses it to one frame. The union is assembled per frame from the real content — every
  tessellated arc, the target orbit and Earth's disc — rather than from a fixture.
- **The planner's interactions (#133, #134, #135, #137).** Clicking the planned
  trajectory places a burn there, snapped per DEP-07 and refused with `L5` rather than
  silently merged when it lands inside FR-101's one-second separation. Dragging a node
  marker changes its epoch and dragging a Δv handle changes that component, both
  quantised on release rather than continuously, both cancelled by Escape — which
  restores nothing, because a gesture never touches the plan until it is released.
  Dragging a node past a neighbour **reorders** rather than clamping: the node keeps its
  Δv and the list re-sorts, which is what the player was plainly trying to do, where a
  clamp would stop them short with no explanation and produce a plan they did not ask
  for. §8.3.5's node editor gives all of it a numeric route — four epoch fields that
  reject an out-of-range entry on blur and restore the previous value, Δv fields taking
  full float64, steppers at 1 m/s with Shift for a tenth and Ctrl for ten times, and a
  result block showing apoapsis, periapsis and period as **live deltas against the
  pre-burn orbit**. That block is the answer to what the M1 spike measured: a 45 m/s
  change moves the drawn trajectory 5.455 px at LEO, so the picture cannot teach a Δv
  edit and the numbers have to.
- **§8.5.3's keyboard map, for the planner (#133–#135, #137, NFR-016).** `N` to add at
  the scrub head, `Delete` to remove, `E` to edit, `Tab` to cycle, `,`/`.` to nudge an
  epoch, the arrows to nudge prograde and radial, `[`/`]`/`Home`/`End` to scrub, `Enter`
  to commit and `Escape` to cancel — with §8.5.3's modifiers, and the same step rule the
  node editor's steppers use rather than a second statement of it. Installed on the
  document, so a binding works wherever focus is, and guarded so nothing fires while the
  player is typing into a field.

- **DEP-07 — node snapping to the nearest apsis within 30 s**, in `@hh/game/snap`, disableable
  from the assist tray. Its `docs/PHYSICS.md` row moves from planned to implemented and records
  that the node-crossing half is deliberately absent: every v1.0 contract is equatorial-equivalent,
  so the line of nodes is undefined.

### Removed
- **The M1 spike page (`apps/web/src/spike/`, #238)** and its route, nav entry, catalogue key and
  ESLint exemption. It existed to prove a node could be dragged at 60 fps before there was a
  planner to drag one in; the planner is that, so keeping it would be keeping the prototype after
  the product. Its measurement — a 45 m/s Δv edit moves the drawn trajectory 5.455 px at LEO —
  is what the readouts and the node editor exist to carry, and it survives in `docs/SPIKE-M1.md`.

- **The application shell, the contract briefing, and the save (#117, #120, #183).** Hash routing
  over §8.2's whole table, with a screen frame that moves focus to the new heading on every route
  change — a hash change replaces the document body and leaves focus on a link that no longer
  exists, which strands a keyboard user silently — and a §9.4 entry transition that collapses to
  0 ms under `prefers-reduced-motion`. An unknown hash renders a not-found screen rather than a
  blank one. The seven routes whose screens are other issues render a placeholder inside the real
  frame, each showing its own heading and captured segment, so a deep link is checkable before the
  screen that consumes it exists.
- **The briefing (§8.3.3)** — the first screen that renders real content. Contract number and
  title, client and fee, the brief from its catalogue key, objective, Δv budget, deadline and par
  (**always shown**, D12), a row per §6.5 constraint, and the ship and target setup lines, all read
  out of the contract's own JSON. Numbers arrive in SI and leave in display units through the
  catalogue rather than through the component, because metres-to-kilometres is a locale decision as
  much as a unit one; §8.3.3's SI tooltip is a `title` **and** a visually-hidden span, since a
  `title` is invisible to touch and unreliable to a screen reader. ACCEPT is bound to `Enter` on the
  document, because focus is on the heading when the route change hands it over. Contracts are
  bundled and parsed at load, never fetched — that is what makes "no loading screen" true rather
  than asserted.
- **Versioned save data (FR-701, FR-703, §11.7).** One `localStorage` key, one JSON document, an
  explicit migration chain of pure functions, and export/import that round-trips byte-identically
  through a canonical form. A save from a newer build is **refused before it is read** and left
  untouched: reading the fields we recognise and ignoring the rest is how a v2 save comes back as a
  v1 save with no medals and then gets written back that way. Corrupt data is reported with its
  bytes intact, quota-exceeded is a returned outcome rather than an exception, and every load hands
  back a usable save so the game stays playable when storage does not work (FR-702).
- **`clientKey` and `fee_kcr` on the scenario schema**, both optional, so §8.3.3's client and fee
  lines have something to render. `clientKey` is a catalogue key for the same reason `briefKey` is
  one — "withheld" is prose — and §13.4's brief-keys check now covers it, so a contract naming a
  client nobody wrote fails the content suite.
- **The orbit scene (#106–#111, #113–#115, #177, §9.3).** Everything the planner draws.
  Earth to scale with Natural Earth 1:110 m coastlines and a terminator derived from a Sun vector
  the game layer supplies; hazard shells that serve both the 100 km floor and §6.5's no-fly annulus
  through one mechanism; the three trajectory styles as **three dash patterns, not three colours**;
  ship and target markers with fading trails; maneuver nodes with a two-axis handle cross on the
  RTN basis; and apsis ticks and a closest-approach tie line. **No text is drawn on the canvas** —
  a DOM label layer positioned by `transform` holds every string, and every string resolves through
  `@hh/ui`'s catalogue. Plus a pure hit-test index with 32 **CSS**-pixel targets and a documented
  priority order, and `devicePixelRatio` handling capped at 2 that survives a move between displays.
- **The planned trajectory's dots are spaced by equal *time*, and that is asserted.** §9.3 asks for
  it because the density then shows the speed — sparse at periapsis, dense at apoapsis — and a dash
  array cannot express it, since `setLineDash` spaces marks by arc length and knows nothing about
  the body traversing the path. The test measures the ratio of dot spacing at periapsis to apoapsis
  against vis-viva's `(1+e)/(1-e)` at three eccentricities, with a circular orbit as the control.
- **Natural Earth coastline data and its processing script (#177, §9.6).** `pnpm coastlines:write`
  fetches the pinned upstream release, verifies its SHA-256, reads the shapefile directly rather
  than trusting a third party's GeoJSON re-encoding, simplifies on the sphere, and writes
  delta-encoded rings. Reproducible: the same input gives a byte-identical output.
- **`#/scene`, a development harness** that draws the full scene against the real `c03-cold-open`
  contract. Throwaway, on the same terms as the M1 spike, and the place the renderer's visual
  claims — the DPR cap, greyscale distinguishability, Earth overflowing the viewport — are actually
  checked rather than asserted.

### Changed
- **§11.7's ~15 kB figure covers the campaign, not the dailies.** A completed 18-contract campaign
  measures 8 729 bytes, comfortably inside it, and eighteen 300-character replay codes are 5 400 of
  those — so replay length is the number to watch, not the field count. A year of daily results is
  **18 728 bytes on its own**, more than twice the campaign and past the stated budget with no
  contracts at all. Nothing is done about it here; the test records it so that #163 and M7 decide
  whether to prune with the number in front of them.
- **The save's `daily` record is `{ days, streak }`**, where §11.7's sketch puts `"streak"` in among
  the dates. A map whose values are either a result or a number has no useful type and forces every
  reader to narrow, and `"streak"` is a legal key in the same namespace as the dates. §11.7 is a
  jsonc illustration rather than a schema — its `settings` is a comment — and this is the one place
  taking it literally would cost something permanent.
- **`@hh/render` joins the NFR-022 coverage gate**, its stated condition ("once it holds code and
  has a browser-environment testing story") now being met. A `render-dom` Vitest project runs
  `*.dom.test.ts` under jsdom; the rest of the package stays under Node, deliberately.
- **§9.6's "~15 kB" estimate for the coastline asset does not hold.** At a precision meeting §9.3's
  0.5 px screen-space standard the data is 47 kB raw and 20.3 kB gzipped delta-encoded — and 74 kB
  raw, 31 kB gzipped, as literal GeoJSON. The estimate was an estimate; this is the measurement.
  Well inside NFR-020's 400 kB budget, which the app now spends 59.7 kB of, but the product
  definition's number should be corrected rather than quietly missed.

- **The par harness (#89, §6.7, DEP-12).** `tools/pars/` computes a contract's `par_dv` and
  `par_time` rather than taking them on trust: a grid over departure epoch and time of flight, every
  Lambert branch at each point, the best of each transfer family refined by a Nelder–Mead simplex,
  and the winner then built as a real quantised `Plan` and run through the game's own timeline,
  objective evaluator and legality check — so a published par is a number the game produced from a
  plan it would let a player commit. `pnpm pars:write` writes the answer into the scenario file and
  `docs/PARS.md`; `pnpm pars:check` recomputes it in CI and fails when it has moved, the same
  arrangement `schema:check` and the goldens have. **The rounding is the tolerance:** values are
  written at DEP-09's own quanta, 1e-4 m/s and 1e-3 s, and compared exactly, because §11.4 declines
  to claim bit-identical results across engines and a tolerance bolted on top would be a second
  number to argue about. C03's search takes about a second and agrees with the closed-form
  tangential impulse to 3.1e-5 m/s — two code paths that share only the value of μ.
- **`docs/PARS.md` (§6.7, §11.5).** The derivation for every contract, generated from the solver's
  own output. §11.5 rules that a par without a reproducible derivation is not mergeable, and D12
  makes par public and beatable — which makes this a forensic document, the thing a "I beat par"
  bug report gets checked against. It states the method, the three things the method cannot do,
  the search statistics, the closed-form comparison, and how to reproduce it in one command. A
  hand-maintained version would be the first thing to fall out of date, and a stale derivation is
  worse than none.
- **`c03-cold-open`, the first shipped contract (#91, FR-204).** An `intercept`: a 400 km circular
  orbit, KESTREL-2 in an 800 km circular orbit 14° ahead, 300 m/s of budget, a three-hour deadline
  inside a six-hour horizon. Contracts live in `content/contracts/` — data at the top of the
  repository where a contributor looks for them, rather than inside the package that owns the
  *format* and no particular contract. Its brief and its coach mark are catalogue keys, not prose
  in the scenario file (D14).
- **The content test suite (#87, §13.4).** One parameterised file over `content/contracts/`, so
  **adding a contract adds seven tests for free and offers no way to avoid them** — which is what
  makes G6 safe. Solvability, par accuracy to ±0.5%, budget headroom ×1.15, deadline headroom
  ×1.10, schema validity, reachability, and every `briefKey` and `coachMarks` entry resolving.
  Each check is its own `it` inside a `describe` named for the contract, so a failure prints which
  contract and which check without anyone reading a log. Three assertions ride along that §13.4
  does not list and nothing else would catch: that a file's name equals the id inside it, that
  `par.burns` matches the reference solution (§6.7 makes Gold depend on it), and that the replay's
  own §11.6 claim agrees with the plan beside it.
- **§6.8's unlock rule, as something a test can ask questions of.** Reachability is a property of
  the whole content set, not of one file, so `tools/content/reachability.ts` walks the progression
  graph to a fixpoint — act I open from a cold start, act *k* opening on ⌈2/3⌉ of act *k*−1's
  shipped contracts, `unlocks` adding explicit edges on top. It gates on what **ships** rather than
  on §6.8's designed act sizes, because that is what the game would do and because a rule written
  against a table would be a copy of `docs/PRODUCT.md` living in code. With one contract the
  content suite's reachability row passes trivially, so the rule is exercised separately against
  sets that are supposed to fail — a check that can only pass is not a check. Progression proper is
  #82 in M3, and this moves into `@hh/game` when it lands.
- **`no-tools-in-shipped-code` (NFR-020).** Nothing under `packages/` or `apps/` may import
  anything under `tools/`. #89 requires the par harness to be a development tool that is not in the
  bundle; nothing imports it today, which is a fact about this week rather than a property of the
  repository. The guardrail suite demonstrates the rule firing, like every other layering rule here.
- **`@hh/game`'s evaluation surface (FR-106, FR-107, FR-108).** Given a timeline and a contract:
  what did the player achieve, what rules did they break, and may they commit. Objectives are
  `reach_orbit`, `intercept`, `rendezvous` and `soft_rendezvous`; `station` is a separate type and
  arrives with contract 07. Constraints are the Δv budget, the deadline and the 100 km altitude
  floor. Legality is `L1`–`L6`, with every simultaneous failure returned together rather than one
  at a time. All of it is pure computation — no DOM, no clock, no randomness — so it runs under
  Node and would run unchanged in a Worker.
- **`reach_orbit` compares the final arc, not a sample (§6.4).** A Keplerian arc has constant
  elements, so the orbit a plan leaves the spacecraft in *is* the last arc's elements, held to the
  horizon by construction. There is no sampling window in which a transient mid-plan match could be
  caught, which is what "held at the end of the plan" asks for. Which elements are compared, and at
  what tolerance, is now written down rather than implied: periapsis and apoapsis radius to 10 km,
  inclination, RAAN and argument of periapsis to 0.1°, each corresponding to about 10 km of
  position error at a LEO radius. A circular goal does not compare the apse line and an equatorial
  goal does not compare the node line — tested on the **goal**, so a plan cannot pass by being
  accidentally degenerate.
- **Proximity objectives use the closest-approach finder, never a sampling grid (#61).** Two orbits
  crossing at 1° inclination close at 134 m/s, so a 1 km intercept window is about fifteen seconds
  wide against a sample spacing of about 172 s: a sampled evaluator would step over the transfer
  and tell the player they missed it. Every local minimum is tested rather than only the global
  one, because for a rendezvous the closest pass may be the fastest one and a later, wider, slower
  pass can be the one that satisfies both limits at once.
- **Constraints return every violating interval, never a boolean (FR-107).** §6.5 draws these as
  shaded bands on the timeline, and a band needs two epochs. The altitude floor runs the
  shell-crossing finder (#62) per arc and merges intervals that abut, so one dip that spans a burn
  draws as one band. Even the Δv budget has an interval: it is exceeded from the burn that crossed
  the cap onward.
- **Scenario format v1 (FR-201, FR-202).** A JSON Schema with the TypeScript types **and the
  validator** generated from it by `pnpm schema:write` and gated by `pnpm schema:check`. Unknown
  fields are rejected rather than ignored — a typo in a contributed scenario has to be an error,
  because silence would mean the contributor's intent quietly did nothing. The loader reports every
  field-level error at once, each with a JSON pointer and a catalogue key, and checks the semantics
  a schema cannot express: an objective naming a target that is not there, a deadline past the
  horizon, a duplicate constraint, a ship starting below its own floor, and a tolerance looser than
  the departures table promises the player. Loading and validating measures **9.4 µs** against
  §11.9's 20 ms budget.
- **The validator ships as generated code, not as a runtime dependency.** Ajv compiles the schema
  ahead of time in `tools/schema/generate.mjs`; `@hh/game` keeps its zero third-party runtime
  dependencies, the bundle avoids ~35 kB gzip, and nothing calls `new Function` at load time.
- **Message catalogue (FR-910, NFR-028).** `@hh/game` emits keys and parameters; `@hh/ui` resolves
  them. A message is a **function** of its parameters and the locale's formatters rather than a
  template string, so it can put a parameter wherever the language wants it and branch on
  `Intl.PluralRules` — Polish has four plural categories and English has two. The catalogue is a
  mapped type over every declared key, so a missing message and a spare one are both compile
  errors; `tools/guardrails/catalogue.test.ts` covers the rot a type cannot see, a key nothing
  produces. A missing dynamic key — a scenario's `briefKey` — throws in development and renders a
  visible marker in production, never a blank.
- **An ESLint rule against literal text in JSX (NFR-028).** Three `no-restricted-syntax` selectors,
  no new dependency: element text, string literals in expression containers, and the attributes a
  screen reader reads out. `{' '}`, interpolated values and non-visible attributes stay legal. The
  guardrail suite demonstrates each selector firing and each legitimate construct staying silent,
  and asserts the application passes. `apps/web`'s own strings moved to the catalogue in the same
  change — a rule with an exemption for the code that was already there is a rule nobody trusts.
- **Departures registry (§7.5, NFR-005).** The gameplay-departures table now exists as data as well
  as prose, and `tools/guardrails/departures.test.ts` fails when the two disagree about which
  departures exist, which package each lives in, or which the player is told about. This closes the
  half of NFR-005 `dependency-cruiser` cannot see: a tolerance written straight into the wrong
  package needs no illegal import and looks exactly like a physical constant.
- **Golden trajectories (§7.6 Tier 4).** 31 committed plans with their evaluated states at fixed
  epochs — 326 sampled states in all — covering every conic class including exactly parabolic, the
  degenerate geometries (e = 0, i = 0, both, i = π, polar), the degenerate plan structures (empty,
  a node on the start epoch, a node on the horizon, the minimum legal spacing, a zero-Δv node,
  twelve nodes), and two plans that change conic class mid-timeline. CI fails when a value moves by
  more than 1e-9 relative. **A golden asserts that a number has not changed, never that it is
  right**; the tests it sits behind are what say it is right.
- **A golden that moves takes `docs/PHYSICS.md` with it.** §11.13 has promised this check since M0
  and nothing enforced it. `tools/goldens/physics-doc-gate.mjs` now does, on every pull request: a
  fixture file only moves when an evaluated trajectory moved, which makes it a change to the
  physics model rather than to a test fixture. The check is deliberately shallow — it asks whether
  the document is in the same diff, not whether what was written there is any good, because no
  script can check the second and pretending to would be worse than not trying.
- **In-process determinism fuzz (FR-109).** 10 000 seeded random plans per CI run, each evaluated
  twice, compared on every float a timeline holds — arc boundaries, arc states, cached elements,
  both sides of every impulse, the inertial Δv, and five `stateAt` lookups — with `Object.is`, so
  `-0` and `+0` are distinguished and the comparison is bit-level rather than numeric. §11.4
  requires same-runtime determinism to be *exact*, and a tolerance would mask exactly the bugs this
  exists to catch. A 200 000-plan soak found no difference. Cross-runtime agreement is out of scope
  and remains #73.
- **Benchmark regression gate (NFR-011, NFR-021).** The benchmarks asserted §11.9's hard limits and
  nothing else, which catches a catastrophe and misses a forty-percent regression entirely. They now
  record their measurements and `pnpm bench:check` compares them against a committed baseline. Three
  choices in the comparison were measured rather than assumed: the **minimum** over each benchmark's
  batches rather than the median (worst-case run-to-run spread 19.7% against 31.5%); a baseline
  recorded **from CI** as the per-metric median of five runs; and each metric divided by the
  **median across all twenty in the same run**, so the gate asks whether an operation got slower
  than its neighbours did. The tolerance is 30%.
- **The relative comparison exists because the runner fleet spans a factor of two.** Six CI runs of
  one identical commit executed the suite at 0.52× to 1.02× of each other's pace. Absolute
  comparison across that cannot work — the fastest host reads 48% under a baseline recorded on the
  mid-range ones — while dividing by the run's own median removes the host exactly and leaves a
  per-metric scatter that is flat across the whole range (worst upward deviation 9.7% to 14.4%).
  The known blind spot is a uniform slowdown, which divides out; §11.9's absolute hard limits still
  backstop it and the host offset is printed on every run.
- **A synthetic normalisation was tried and rejected on measurement.** Every benchmark also times a
  frozen scalar arithmetic loop and records `measurement / yardstick`, on the theory that a
  dimensionless ratio makes a baseline portable. It over-corrects across machine families (a runner
  is 1.16× slower than the development machine on real workloads but 1.45× slower on the yardstick,
  putting every normalised row a systematic 22% under its baseline) and under-corrects within the
  fleet, while adding noise of its own. Two runs with yardsticks of 364 ns and 365 ns executed the
  suite at 0.96× and 0.79×. The ratio stays in the recorded results as the evidence for the
  decision, and is not used by the gate.

- **The two §11.9 frame-time budgets are measured** for the first time — idle 0.008–0.010 ms,
  dragging a node 0.041–0.048 ms, against 4 ms and 8 ms targets. What is measured is the geometry
  pipeline owned by `@hh/sim` and `@hh/render`; rasterisation is the browser's and cannot be
  measured from Node, so **passing does not mean §11.9's frame rows are met** — that is a
  real-device pass, #188 and #189. The benchmark says so, and so does `docs/PHYSICS.md`.
- **Benchmark files no longer run in parallel.** Four benchmarks competing for the same cores while
  each tries to measure elapsed time were partly measuring the scheduler. It matters more now that
  a gate reads those numbers.
- `@hh/sim` gains the **timeline**: applying a plan to an initial state over a horizon produces
  the alternating sequence of Keplerian arcs and instantaneous impulses FR-102 describes, with
  `stateAt` evaluating it anywhere inside the horizon and `withPlan` re-evaluating it from an
  edited node onward. This is what turns a plan into a trajectory; until now `@hh/sim` held the
  plan and nothing that ran it.
- **The empty plan is not a special case.** It produces one coasting arc from the start epoch to
  the horizon because the fold never enters its loop, not because a branch checks for it. A
  structure whose degenerate case is written separately is a structure with two behaviours to
  keep in step.
- **A node epoch belongs to the arc that starts there.** Timeline arcs inherit the half-open
  `[start, end)` rule the event finders already run on, so `stateAt` at a node returns the
  **post-impulse** state and the pre-impulse one is on the impulse record. The last arc is closed
  at the horizon so the deadline itself is evaluable, and an epoch outside the horizon is rejected
  with a typed `EpochOutOfHorizonError` carrying the bounds, rather than extrapolated into a plan
  that says nothing about that time.
- **Incremental re-evaluation is the same fold entered later, not a second implementation.**
  Arc *j*'s state depends on the initial state and nodes 0 … *j*−1, so an edit at node *k* cannot
  reach anything before *k*; `withPlan` diffs on the integer counts, reuses the earlier arcs **by
  reference** — element caches and all — and restarts the same loop at *k*. Moving, inserting and
  deleting a node are therefore one path rather than three. Measured: an 8-node plan re-evaluates
  fully in 0.03–0.05 ms against §11.9's 2 ms target, a last-node drag in 0.007–0.009 ms against
  NFR-011's 16.7 ms frame, and a timeline `stateAt` in 0.8–1.4 µs against a 5 µs target.
- **The arc lookup is measured as a binary search, not asserted as one.** Timing `stateAt` would
  prove nothing — the Kepler solve costs microseconds and the search nanoseconds — so the
  benchmark times the search alone: 228× more arcs costs 4.0× more, against 3.5× for a binary
  search and 228× for a linear scan.
- `@hh/propagation` gains the **five FR-008 event finders**: apsis crossings, closest approach
  between two independently propagated bodies, altitude-shell crossings, ground-station conical
  visibility, and cylindrical umbra intervals. They ship together because the interesting part of
  each is the same three decisions — what an interval endpoint means, what tolerance a returned
  epoch carries, and what happens to a feature the search cannot resolve — and five finders written
  apart would have answered them five ways.
- **The endpoint rule is half-open, `[start, end)`.** An event exactly at the start is reported and
  one exactly at the end is not, so searching two abutting arcs and concatenating reports every
  event exactly once instead of leaving a caller to de-duplicate on a float comparison. An interval
  already in progress at a bound is returned **clipped**, flagged as such, rather than dropped —
  a pass that begins at `start` because the search began there is a different fact from one that
  begins there because the spacecraft rose.
- **Apsis and shell crossings are closed-form, not root-found.** Both issues asked for root-finding
  to a stated tolerance; on an unperturbed conic both are algebraic — periapsis *is* true anomaly
  zero, and `r = p/(1 + e cos ν) = R` solves for `ν` directly — so they are exact to round-off,
  have no convergence tolerance, and have **no floor on the shortest feature they can find**. The
  shell's inverse cosine is written as a half-angle `atan2`, which `acos` is banned for (NFR-006)
  and which stays well conditioned at both ends besides.
- **Umbra samples in true anomaly rather than in time.** The shadow condition depends only on where
  the spacecraft is, so the grid is uniform in position around the orbit; that is what makes a
  short eclipse near periapsis no harder to find than a long one near apoapsis. Refinement still
  runs in epoch, so the stated tolerance means what it says.
- `@hh/astro` gains the **ECEF frame**: `EcefVector`, `ecef`, and the body-fixed ↔ inertial
  rotation. A ground station is the one thing in this simulation that is constant in the rotating
  frame and not in the inertial one, so it is stated in the rotating one and the compiler refuses
  to let it be passed where an inertial vector belongs. The rotation takes an **angle**, not an
  epoch — converting an epoch needs a sidereal-time model, which is data with a source and an
  expiry, and a scenario states its own station angle.
- `@hh/sim` opens with the **plan side of the simulation**: `Plan` and `ManeuverNode` with
  quantisation at entry (FR-101, FR-105, DEP-09), impulsive Δv applied in RTN (FR-006), and
  canonical JSON serialisation of a plan (§11.6). A node's canonical identity is its **integer
  count** — ticks of 1/1024 s and counts of 1e-4 m/s — and its SI values are derived from those
  counts rather than from the caller's arguments, which is what makes quantisation idempotent by
  construction rather than by discipline. FR-101's "≥ 1 s apart" is an integer comparison, because
  differencing two 2026 epochs as floats loses about 1e-7 s to cancellation and a plan that
  validates on one runtime should not fail on another.
- `@hh/sim` gains **canonical JSON replay codes**: keys sorted by an explicit writer rather than
  inherited from a literal's insertion order, no whitespace, integers only, and strict parsing that
  rejects an unknown schema version, an unrecognised key or a non-integer instead of dropping it.
  Node epochs are written as mission-elapsed ticks — §11.6's own claim field is plainly MET — so the
  origin cancels exactly on the way back. A share code for an 8-node plan measures 306 bytes, or 408
  base64url characters **with no compression at all**, which is how FR-607's 512-character budget is
  asserted: deflate is headroom, not an assumption the budget rests on.
- `@hh/render` gains the **`Renderer` seam and a Canvas 2-D implementation**. The interface takes a
  whole `Scene` bucketed by layer rather than a stream of drawing calls, so §11.8's draw order lives
  in the package as a constant instead of emerging from the order a caller happens to make its
  calls. There is no text primitive at all — that is what keeps labels in the DOM (D8) rather than
  leaving it to review — and the backing store is capped at 2x for battery.
- `@hh/render` gains an **orthographic camera**: pan and zoom as pure state transforms with no
  canvas anywhere, auto-framing of the ship ∪ target ∪ plan ∪ Earth union with a 12% margin, the
  20% re-frame rule, and manual zoom clamped to [0.5x, 40x] of the auto-frame scale. Scale is
  linear, per §8.4. The world-to-camera transform runs in float64 and `projectInto` is the only
  float32 in the package (NFR-010) — a test asserts that narrowing the world coordinate first
  loses more than a pixel of a 100 m detail at 1e8 m, which is the failure the rule exists to
  prevent.
- `@hh/render` gains **orbit tessellation with adaptive subdivision**, sampled in eccentric
  anomaly for an ellipse, hyperbolic anomaly for a hyperbola, and Barker's `D` inside a band around
  `e = 1`, refined until the screen-space sagitta is under 0.5 px and capped at 512 vertices. The
  cache is keyed by (elements, scale bucket) and the bucket rounds *up*, so a reused tessellation is
  never coarser than the scale it is drawn at. True anomaly is not in the key — scrubbing the
  timeline does not change the path — and neither is the camera basis or centre, so panning and
  rotating cost nothing. Measured at 0.009–0.09 ms per orbit against §11.9's 0.5 ms target, and
  0.0006 ms on a cache hit.
- **A benchmark for §11.9's orbit-tessellation budget**, alongside the propagation one, asserting the
  2 ms hard limit and reporting the 0.5 ms target.
- `@hh/propagation` gains **universal-variable Kepler propagation**: an arbitrary time offset,
  forwards or backwards, analytically, with one formulation covering elliptic, parabolic and
  hyperbolic orbits and no branch on conic class. Whole revolutions are removed before solving,
  which is what keeps the accuracy of a month-long propagation usable. Non-convergence is a typed
  return value. A single call costs about 1 µs against §11.9's 5 µs target.
- `@hh/propagation` gains the **`Arc`**: one Keplerian segment between impulses, an immutable value
  object whose classical elements are computed on first access and cached. Editing produces a new
  arc rather than mutating an existing one, which is what makes FR-104's incremental recompute safe
  rather than merely fast.
- `@hh/propagation` gains a **numerical integration oracle** — DOP853's 8th-order tableau with
  Richardson step control — reachable only from tests. FR-009 forbids advancing game state with it,
  and that prohibition is now a `dependency-cruiser` rule checked by deliberate violation rather
  than a comment.
- `@hh/astro` gains **equinoctial elements** `(p, f, g, h, k, L)`, with conversions to and
  from both a Cartesian state and the classical set. Non-singular at `e = 0` and at
  `sin i = 0`, which are the common case in this game. Retrograde orbits are supported
  through the retrograde factor rather than rejected.
- `@hh/astro` gains a **zero-revolution Lambert solver**, universal-variable, both transfer
  directions, with the direction chosen explicitly by the caller. Non-convergence is a
  typed return value; collinear positions are rejected with a typed error.
- `@hh/astro` gains the **closed-form two-body relations**: orbital period, mean motion,
  vis-viva, circular and escape speed, specific energy, and the Hohmann and bi-elliptic
  transfers.
- Initial project scaffold from `astro-game-lab/.repo-template`.

### Physics
- **C03's par is 109.1177 m/s and 4 122.965 s, against `docs/PRODUCT.md` §6.8's 217 m/s and
  48 min.** Nothing in the model moved and no golden changed; §6.8's figure is simply the wrong
  quantity for this contract. The table quotes a full two-burn Hohmann transfer — which is what
  C02 costs — and C03 is an `intercept`, where DEP-04 asks for 1 000 m of range and says nothing
  about relative velocity, so the circularisation burn buys nothing the objective wants. One
  prograde impulse raising apoapsis to the target's radius is the whole solution. The time is
  *larger* than 48 min for the matching reason: 48 min is the transfer alone, and the contract's
  departure phase makes the player wait about twenty minutes for the window — which is the lesson
  §6.8 itself assigns to C03. §6.8 states of its own numbers that they are indicative and not
  authoritative, and `docs/PRODUCT.md` is maintained outside this repository, so it is not edited
  to match; `docs/PARS.md` records the divergence and is the authority here.
- **DEP-01 is a core row, not a game-layer one.** `docs/PRODUCT.md` §7.5 places impulsive burns in
  `@hh/game/maneuver`; they are in `packages/sim/src/maneuver.ts` and cannot move, because FR-102
  defines a timeline as alternating Keplerian arcs and impulses and `@hh/sim` may not import the
  layer above it to ask what a burn means. It is now marked in `docs/PHYSICS.md` the way DEP-09 and
  DEP-11 already were — a departure that is not a simplification for fun, with the reason stated.
  No number moved; the model is unchanged.
- **DEP-13 added.** §6.4 requires `reach_orbit` to match its goal "within tolerance" without saying
  which elements or how much. The answer is now a numbered row rather than a constant in a file.
- Both differ from `docs/PRODUCT.md` §7.5, which is maintained upstream. `docs/PHYSICS.md` records
  the divergence and is the authority for this repository until the next sync.

### Changed
- `pnpm coverage` no longer runs the benchmark project (`vitest run --project !bench`). V8 coverage
  instruments every function and slows the code under measurement by roughly a factor of four, so a
  §11.9 budget asserted under it measures the profiler rather than the simulation — the
  ground-station search's 3.3 ms reads as 13.9 ms and trips an 8 ms limit nothing has broken. The
  second reason points the same way: a line reached only by a benchmark is *timed*, not tested, and
  counting it as covered overstates the number NFR-022's gate exists to keep honest. `pnpm bench`
  and `pnpm test:all` are unaffected.
- `@hh/render` compiles against its own TypeScript project. It draws on a canvas, so it needs the
  DOM library, and the root project deliberately has none so that a browser type in the simulation
  core is a compile error rather than something only the lint rule's list of global names catches.
  `pnpm typecheck` now runs three projects, and the guardrail suite checks both halves of the split
  by deliberate violation. Only the Canvas 2-D implementation actually needs a DOM; it sits behind
  the `@hh/render/canvas2d` subpath so the package's barrel — and the camera and tessellator behind
  it — stays runnable under Node.

### Removed
- **Pull-request preview deployments.** Every pull request published its build to
  `pr-preview/pr-<n>/` on `gh-pages` and commented the link; the whole facility is gone — both
  workflows, `tools/pages/pr-comment.sh`, and `publish.sh`'s second mode. A branch is verified
  locally instead: `pnpm build`, `pnpm --filter @hh/web preview`, and a real browser pointed at it.
  Two things follow from previews being the only other writer to the branch. `publish.sh` no longer
  preserves a path it does not own and no longer has a `remove` mode, so its usage is now
  `publish.sh <source-dir> <message>` and a publish replaces the tree whole. And the first deploy to
  `main` after this lands takes the stale preview directories with it, so no cleanup step has to be
  written or run.

### Fixed
- `docs/PHYSICS.md` said angles normalise to `[0, 2π)` "everywhere, without exception". Two of them
  do not, and one of the two was already shipping: hyperbolic anomaly, which is not periodic, and
  now topocentric elevation, which is a latitude-like coordinate on `[-π/2, π/2]` whose sign is its
  entire content — wrapping −10° to 350° would make `elevation ≥ mask` true for every spacecraft on
  the far side of the planet. The convention now says it governs *circular* angles and names both
  exceptions, rather than being a rule the code has to quietly break.
- `docs/PRODUCT.md` §11.6's "an 8-node plan is ~120 bytes of JSON" was optimistic by a factor of
  about 2.5 and is replaced by the measurement: 306 bytes, 408 base64url characters. A 123.75 m/s
  burn is 1 237 500 quantised counts, and every node carries three of those plus an epoch.
- `docs/PHYSICS.md` recorded DEP-09 as living in `@hh/game` and described quantised values as
  "exactly representable". Quantisation is a determinism mechanism (§11.4) and now lives in
  `@hh/sim`, and what is exactly representable is the integer count: 1/1024 is a binary fraction,
  1e-4 is not, so a quantised Δv is the correctly-rounded product rather than the decimal it prints
  as. The departures table's preamble now accounts for its two core-resident rows instead of
  forbidding them.

### Physics
- **The umbra is a cylinder, and that costs something measurable.** The real umbra is a cone — the
  Sun is a disc, so the shadow closes about 1 384 000 km behind Earth — and there is a penumbra
  outside it. This model has neither, which makes its shadow wider than the real one, increasingly
  so with altitude. Measured for a circular orbit with the Sun in plane: at 400 km the eclipse is
  **36.11 min against a true-cone 35.71 min, 1.1% long**; at geostationary altitude **69.41 min
  against 67.28 min, 3.2% long**. The penumbra, reported here as full sunlight, is a further
  0.8 min at 400 km and 4.3 min at GEO. **No previously published number has moved** — the shadow
  model is new — but the closed form behind it lands on the widely quoted ~36 min ISS eclipse and
  ~70 min maximum geostationary eclipse, and `docs/PHYSICS.md` records that those are quoted
  figures rather than a citable worked example.
- **Near-tangential shell crossings are ill-conditioned in epoch, and the closed form does not fix
  it.** Where a trajectory grazes a shell `dr/dt → 0`, so a fixed radius error becomes an unbounded
  epoch error. Measured on a 400 × 800 km orbit: the radius residual stays on the float64 floor at
  every separation, while the implied epoch error grows from 2.0e-11 s at 100 km below apoapsis to
  2.8e-8 s at 1 cm below it. A root-finder would inherit exactly the same conditioning; this is the
  geometry, not the method.
- **A circular orbit cannot be asked where it crosses a shell.** `cos ν* = (p/R − 1)/e` divides one
  small number by another, and a state built from `e = 0` returns with `e ≈ 1e-16`, so a circular
  orbit sitting exactly on a shell satisfies `r_p < R < r_a` in float64 — and a naive search
  reports being inside for half of every revolution, over a radius excursion of a nanometre. The
  finder now treats `e ≤ 5e-16`, the measured cancellation floor on the eccentricity magnitude, as
  circular and answers *entirely inside* or *entirely outside*. Circular orbits are the common case
  here, so this is the ordinary path rather than an edge case.
- **Impulsive Δv, with no model change.** FR-006 is applied through the existing `fromRtn`,
  unchanged: instantaneous, same position, no mass. **No published number has moved.** What is new
  is a frame property that was implicit and easy to get wrong — **impulses do not add in RTN
  components.** An impulse changes `v`, so `r × v` moves and the `T̂`/`N̂` axes rotate under the
  second delta-v. §13.3's "two impulses at the same epoch equal their vector sum" holds in the
  *inertial* frame; the RTN-component reading is now asserted to *fail*, by a margin two orders of
  magnitude above float64 noise, so it cannot be reintroduced quietly. `docs/PHYSICS.md` states it
  under the RTN frame.
- **Propagation exists, and is checked against an independent numerical method.** The analytic
  propagator and the DOP853-tableau oracle share no code, and agree to between 4e-14 and 7e-12
  relative across elliptic, near-parabolic and hyperbolic cases — inside the oracle's own
  sensitivity to its tolerance, which is where the test's threshold comes from rather than from
  what made it pass. **No published number has moved.** What is still missing is a Tier 3 external
  reference: both methods are ours, so the cross-check cannot catch a shared misunderstanding of a
  convention. The `poliastro`/Horizons row stays open against #55.
- **Corrected claim.** `docs/PHYSICS.md` implied §13.3's time-reversal requirement — 1e-12 relative
  over ±30 days — held across the element domain. It does not, and no propagator can make it: a
  float64 state determines its own orbital period to about one `eps`, and a few hundred revolutions
  amplify that past 1e-12. The measured envelope is now tabulated, together with the region where
  the flat 1e-12 does hold (`N·(1−e)^−2.5 ≤ 60`, which covers every v1.0 contract).
- **New measurement.** The oracle's energy drift is linear in orbit count and proportional to the
  requested tolerance — 4.5e-11 relative over a hundred orbits at `rtol = 1e-13` — and angular
  momentum drifts about three times less, not orders less. Recorded because an oracle whose fitness
  is assumed is not an oracle.
- **The Tier 1 closed-form validation suite is complete.** Every Tier 1 row in
  [`docs/PHYSICS.md`](docs/PHYSICS.md) now has a passing test with its expected value
  re-derived from the constants and, wherever one exists, an external anchor that does not
  come from those constants at all. **No published number has moved.**
- **Corrected claim.** `docs/PHYSICS.md` implied the equinoctial formulation fixes the
  cancellation in the eccentricity vector at low `e`. It does not, and nothing can: `e` at
  `1e-10` carries about `5e-16` of absolute error however it is computed, because that is
  the float64 representation limit of the *state*. What the equinoctial set fixes is the
  *periapsis direction*, whose classical error scales as `5e-16 / e` and which the
  classical convention stops reporting at all below `e = 1e-8`. The numerical notes now say
  so, with measurements.
- **Clarified claim.** The bi-elliptic thresholds 11.94 and 15.58 answer two different
  questions and are not the ends of one range. Both are now measured (11.9388, 15.5817) and
  shown to be independent of `μ` and of the inner radius.
- **New documented singularity.** The equinoctial set is an atlas of two charts switched at
  `i = π/2`; the singularity table records the switch, and that at `i = π/2` exactly the
  chart a round trip returns in is decided by round-off. Determinism is unaffected.
- **Lambert is validated against an independent reference.** Curtis §5.3 Examples 5.2
  (elliptical) and 5.3 (hyperbolic), to the book's printed precision. The hyperbolic case
  is the only external check on the negative-`z` branch of the Stumpff functions.
- **New documented limit.** The zero-revolution Lambert search stops at `4π² − 1e-4`,
  because the Stumpff `C(z)` cancels to exactly zero closer than that. The ceiling admits a
  transfer of roughly `4e19` s; beyond it the solver reports out-of-domain.
