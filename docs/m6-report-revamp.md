# M6: the report's visual revamp (brief, 2026-10-17)

Brief for the step that redesigns how the report looks. Written at the end
of the session that shipped steps 1–5 and the measuring toggle, for a fresh
session. Read this whole file before opening any code.

## Why

Alex, 2026-10-17: the report still looks like "Claude UI design". He wants
something that:

- recalls KSP's visual language;
- is not dated;
- does not shout "an AI made this".

He asked for a real stretch here, not a reskin. It is the first thing a
player sees of T-Minus, and the page M7 will host.

## What exists

- Approved structure, mockup v5: three tabs (Startup / Transitions / Raw
  data), headline, points of attention, time by mod, stages, Holds, raw
  tables. The history is in `docs/m6-web-plan.md` (Status: mockups v1–v5;
  "Report model: shape and decisions"; steps 2, 3a and 3b).
- Current look, mockup v3 → v5. It is a literal imitation of KSP 1's stock
  UI:
  - beveled grey window panels on a starfield with a blue radial glow;
  - kerbal green, amber, red and cyan accents;
  - Chakra Petch headings, Noto Sans body, Share Tech Mono numbers;
  - a "mission clock", Engineer's Report, staging stack and Resources bars;
  - one dark theme.
- Code, presentation only:
  - `tools/analyze/src/report/style.ts`: the CSS, one string;
  - `report/html.ts`: the markup, rendered from the report model;
  - `src/page/behavior.ts`: tabs, Copy summary, Download, raw table tools;
  - `src/page/boot.ts`;
  - `scripts/build-page.mjs`, which writes the template
    `GameData/000_TMinus/Report/template.html`;
  - fonts in `tools/analyze/fonts`, fetched by `scripts/fetch-fonts.mjs`,
    with `fonts.json` and OFL licenses.
- Real pages to look at. Fill the current template with an archived run:
  `node tools/analyze/scripts/fill-template.mjs <runDir> <out.html>`. Use:
  - the bench, `D:\KSP\bench-runs\20261016-213723`: 180 mods, the dense
    case;
  - the scenario, `D:\KSP\scenario-runs\20261017-032812`: 3 findings;
  - dev with measuring off, `D:\KSP\dev-runs\20261017-032225`: log only,
    0 findings, the near-empty case.
- Screenshots: `node tools/analyze/scripts/cdp.mjs <page.html> <script.mjs>`
  drives headless Chrome. The script default-exports
  `async ({ evaluate, shot, wait, setViewport }) => {}`; `shot(file, full)`
  writes a PNG, which the Read tool can show you. Use it on every iteration:
  - desktop width 1280;
  - phone width 390;
  - each tab;
  - the Raw data tab with a table open and filtered.

## Diagnosis: what reads as "AI-made" today

These are the defaults to break away from. Avoid them as a family. Don't
just swap one for another.

- Dark navy "space" background with a starfield and a radial glow.
- Neon-ish accents on dark: lime, amber, cyan, coral. Color used as
  decoration, not to carry meaning.
- Everything in a box:
  - rounded panels with inset bevels and drop shadows;
  - every section a card;
  - cards inside cards.
- Pill chips and badges on every item.
- Small uppercase letter-spaced labels everywhere.
- "Techy" display fonts (Chakra Petch is in the same family as Orbitron and
  Space Grotesk). Mono used for flavor rather than for alignment.
- A big hero number with a caption under it, the generic dashboard opener.
- Even, symmetric stacks of same-width blocks. No typographic rhythm and no
  variation in density.
- Literal skeuomorphism of a game UI: it dates fast and looks like a theme.
- Decorative glyphs and icons that say nothing.

## Direction: evoke, don't imitate

The goal is a page a KSP player recognizes as "of this world" without it
being a costume of the game's 2011–2015 UI. Look for KSP's visual language
in what has aged well, and in the real-world sources KSP itself draws on.

- **The project's own metaphor is a launch countdown.** Startup is the
  *Countdown*, scene transitions are *Holds* (a built-in hold is a real
  countdown term), and the product is *T-Minus*. Real sources:
  - countdown procedure documents;
  - flight plans and mission timelines;
  - console-position checklists;
  - Apollo flight-plan typography;
  - launch-vehicle data sheets.

  These are information design that has stayed good for 60 years. A
  countdown timeline could be the page's spine instead of decoration.
- **The VAB/SPH and the part catalog:**
  - part data in compact spec blocks;
  - manufacturer flavor;
  - assembly drawings and blueprints;
  - the stack as a vertical sequence.
- **KSP's tone:** dry, competent humor next to real engineering. Kerbals
  take rocketry seriously and it goes wrong anyway. The page can carry
  personality through restraint and one or two well-placed touches, not
  mascots.
- **Color with meaning.** KSP's real palette goes beyond lime on navy:
  - safety orange and white of the launch infrastructure;
  - KSC concrete;
  - Kerbal green as a rare signature, not a fill;
  - the navball's sky blue and ground brown;
  - paper.

  Consider a light, paper-first page (with a good dark variant) instead of
  the default dark mode.
- **Information design first** (Tufte, Bringhurst):
  - real typographic hierarchy;
  - tabular figures where numbers align;
  - small multiples and inline bars sized to the data;
  - few boxes;
  - rules and whitespace to group;
  - density where the reader scans (Raw data), air where they decide
    (headline, points of attention).

These are leads, not the answer. Challenge them.

## Process

1. **Absorb, briefly:**
   - this brief;
   - the plan's "The player's journey" and "Report model: shape and
     decisions";
   - `style.ts` and `html.ts` (skim);
   - screenshots of the three real pages above.

   Look for KSP references on the web (WebSearch/WebFetch: KSP screenshots,
   the VAB, the part catalog, KSC, loading screens). Look for real-world
   ones too (NASA countdown procedures, Apollo flight plans, launch
   timelines). Alex can send game screenshots if that helps; ask.
2. **Diverge.** Write down three directions that differ in kind, not in
   palette:
   - a one-paragraph concept;
   - type pairing, with licenses checked;
   - palette;
   - the signature element;
   - what it borrows from KSP;
   - the risk.

   At least one must be light-first. None may be a game-UI costume.
3. **Mock each direction** with the bench run's real data, as static HTML
   built from the current `html.ts` output (or its markup adapted). Cover:
   - the Startup tab;
   - a Hold;
   - a slice of Raw data.

   Screenshot each one at desktop and phone width.
4. **Critique honestly.** Check each mockup against the diagnosis list above
   and against "would a designer at a good studio sign this?". Revise at
   least once before showing anything. Keep a short log of what you changed
   and why.
5. **Show Alex.** Publish the three mockups as private artifacts, side by
   side: one page with the three, or three pages. Write a few lines per
   direction. Recommend one. Alex picks or mixes.
6. **Implement** the chosen one:
   - `style.ts` and `html.ts` (markup may change freely);
   - `behavior.ts` only where the markup moved;
   - fonts through `fetch-fonts.mjs` and `fonts.json`, licenses in
     `GameData/000_TMinus/Report/licenses`.

   Keep each commit small and reviewable.
7. **Validate:**
   - `npm --prefix tools/analyze test`;
   - `check-archived` on the whole archive;
   - one run per install (`tools/run/Invoke-Run.ps1 -Install dev`,
     `scenario`, `bench`), so the mod writes the new template;
   - headless checks: no page errors, tabs, filter, sort, Show more, Copy
     summary, Download, no-JS view;
   - a list of visual checks for Alex in a real browser.

## Constraints that do not move

- **Presentation only.** Leave the report model (`report/model.ts`), the
  sentences (`sentences.ts`, `wording.ts`) and every finding's text as they
  are. If a design needs different words or another field, propose it to
  Alex first. The Markdown and Copy summary renderers are out of scope.
- **The CLI and the page render the same HTML.** `check-archived` compares
  them byte for byte, so the new markup must stay deterministic and come
  from `html.ts` only.
- **Self-contained, private.** The page is one HTML file with no external
  request: no CDN, no web fonts from Google, no analytics. Fonts are
  embedded (woff2, subset) and their licenses must be MIT-compatible (OFL is
  fine). Keep the template near its current size (~450 KB) unless the gain
  is clear, and tell Alex the number.
- **No KSP or Squad/Take-Two assets:** no logos, game art, textures or the
  game's fonts. Evoke the language; copy nothing. The page must not pass for
  an official KSP product.
- **Works without JavaScript.** Every part stays visible and every raw row
  is shown (`behavior.ts` only enhances).
- **Accessible:**
  - WCAG AA contrast in every theme;
  - keyboard tabs (arrow keys);
  - visible focus;
  - `prefers-reduced-motion`;
  - phone width with a 16 px gutter and no horizontal page scroll (wide raw
    tables scroll inside their box).
- **Honesty is visible.** Measured and likely ("~") costs must stay
  distinguishable at a glance (today: a solid and a hatched bar). The same
  goes for the remedy kinds (fixable, trade-off, informational) and the
  notices (measuring off, log only, older profiler).
- **Print** is a nice-to-have: a player may print or PDF it for a forum
  thread.
- Dark/light: decide with Alex. If there are two themes, both follow
  `prefers-color-scheme`. The current page has a dark one only.

## Out of scope

- Report content, ranking, findings, wording.
- M7 (hosting, share link, the web page's input). The design should not
  block it: the same page will be served from the web.
- The in-game popup (stock `PopupDialog`; KSP's skin, not ours).

## Done when

- Alex approved a direction from the mockups.
- The template, tests and `check-archived` are green on the whole archive,
  with a run on dev, scenario and bench.
- `docs/m6-web-plan.md` has a short "Visual revamp" section: the direction
  chosen and why, fonts and licenses, the template size before and after,
  and the visual checks for Alex.
- CLAUDE.md `## Status` is updated.
