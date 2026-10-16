// The report page's style, from the approved mockup (v3, revision 5).
// Fonts fall back to system ones until the page bundles its own (step 3).

export const STYLE = `
/* Layout: KSP's own UI in a browser. Stock-style window panels on deep space: mission clock, Engineer's Report, staging stack, Resources bars, debug console. Single dark look, like the game's UI. */
:root {
  --space: #070b12;
  --panel-top: #2c3238;
  --panel-bot: #1c2025;
  --edge-hi: #59626b;
  --edge-lo: #0d0f12;
  --title: #3a4148;
  --ink: #e4e8ec;
  --dim: #98a2ac;
  --green: #a3e23a;     /* Kerbal green: OK, fills */
  --amber: #ffb62e;     /* warnings */
  --red: #ff5b47;       /* problems you can fix */
  --cyan: #5ec8ff;      /* measured / info */
  --well: #101317;
  --font-head: "Chakra Petch", "Bahnschrift", "Arial Narrow", sans-serif;
  --font-body: "Noto Sans", "Segoe UI", system-ui, sans-serif;
  --font-mono: "Share Tech Mono", ui-monospace, Consolas, monospace;
  color-scheme: dark;
}
* { box-sizing: border-box; }
body {
  background:
    radial-gradient(1px 1px at 12% 18%, #ffffff55 50%, transparent 51%),
    radial-gradient(1px 1px at 72% 9%, #ffffff44 50%, transparent 51%),
    radial-gradient(1.5px 1.5px at 88% 34%, #ffffff40 50%, transparent 51%),
    radial-gradient(1px 1px at 30% 62%, #ffffff33 50%, transparent 51%),
    radial-gradient(1px 1px at 55% 80%, #ffffff3a 50%, transparent 51%),
    radial-gradient(1.5px 1.5px at 6% 90%, #ffffff30 50%, transparent 51%),
    radial-gradient(ellipse 120% 60% at 50% 115%, #12304a 0%, transparent 60%),
    var(--space);
  background-attachment: fixed;
  color: var(--ink);
  font-family: var(--font-body); font-size: 14.5px; line-height: 1.5;
}
.wrap {
  max-width: 820px; margin: 0 auto;
  padding-left: max(16px, env(safe-area-inset-left, 0px));
  padding-right: max(16px, env(safe-area-inset-right, 0px));
  padding-block: 24px 64px;
  display: grid; gap: 22px;
}
h1, h2, h3, h4 { margin: 0; font-family: var(--font-head); font-weight: 600; letter-spacing: .02em; text-wrap: balance; }
p { margin: 0; }
.mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }

/* Stock KSP window */
.win {
  background: linear-gradient(180deg, var(--panel-top), var(--panel-bot));
  border: 1px solid var(--edge-lo);
  border-radius: 6px;
  box-shadow: inset 1px 1px 0 var(--edge-hi), inset -1px -1px 0 #00000066, 0 6px 18px #0008;
  overflow: hidden;
}
.win > .bar {
  display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
  padding: 6px 12px; background: linear-gradient(180deg, #454d55, var(--title));
  border-bottom: 1px solid var(--edge-lo);
  font-family: var(--font-head); font-weight: 600; font-size: .95rem; letter-spacing: .04em;
}
.win > .bar small { font-family: var(--font-body); font-weight: 400; font-size: .76rem; color: var(--dim); letter-spacing: 0; }
.win > .body { padding: 14px; display: grid; gap: 12px; }
.well { background: var(--well); border: 1px solid #000; border-radius: 4px; box-shadow: inset 0 1px 3px #000a; }


/* Mission clock header */
.clockwin .body { grid-template-columns: auto 1fr; align-items: center; gap: 14px 22px; }
.met { padding: 10px 16px; text-align: center; }
.met .lbl { font-family: var(--font-head); font-size: .72rem; letter-spacing: .18em; color: var(--dim); }
.met .t { font-family: var(--font-mono); font-size: clamp(2.2rem, 8vw, 3.2rem); line-height: 1; color: var(--green); text-shadow: 0 0 12px #a3e23a55; }
.verdict { font-family: var(--font-head); font-size: clamp(1.25rem, 3.6vw, 1.6rem); font-weight: 600; line-height: 1.2; min-width: 0; }
.verdict b { color: var(--red); font-weight: 700; }
.facts { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 6px; }
.tag { font-size: .74rem; color: var(--dim); background: #ffffff0a; border: 1px solid #ffffff14; padding: 2px 8px; border-radius: 3px; }
.tag.ok { color: var(--green); border-color: #a3e23a44; }
@media (max-width: 560px) { .clockwin .body { grid-template-columns: 1fr; } }

/* Buttons, stock-style */
.btns { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.kbtn {
  font: 600 .84rem var(--font-head); letter-spacing: .05em; cursor: pointer;
  color: var(--ink); padding: 7px 14px; border-radius: 4px;
  background: linear-gradient(180deg, #4d565f, #353b41);
  border: 1px solid #0b0d10; box-shadow: inset 0 1px 0 #6c7680;
}
.kbtn:hover { background: linear-gradient(180deg, #5a646e, #3e454c); }
.kbtn:active { box-shadow: inset 0 2px 3px #0009; }
.kbtn.go { color: #10200a; background: linear-gradient(180deg, #b6ef55, #7fb92a); box-shadow: inset 0 1px 0 #d6ff8a; }
#toast { font-size: .8rem; color: var(--green); }
.hint { font-size: .78rem; color: var(--dim); }

/* Engineer's Report */
.er { display: grid; gap: 8px; }
.er-row { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; gap: 4px 10px; padding: 10px 12px; align-items: start; }
.er-ico { width: 18px; height: 18px; border-radius: 50%; display: grid; place-items: center; font: 700 .72rem var(--font-head); color: #0a0d10; margin-top: 2px; }
.er-ico.red { background: var(--red); }
.er-ico.amber { background: var(--amber); }
.er-ico.cyan { background: var(--cyan); }
.er-ico.likely { background: transparent; border: 1.5px dashed var(--amber); color: var(--amber); }
.er-row h3 { font-size: 1rem; }
.er-row .cost { font-family: var(--font-mono); font-size: 1.05rem; white-space: nowrap; }
.er-row .cost.red { color: var(--red); } .er-row .cost.amber { color: var(--amber); } .er-row .cost.cyan { color: var(--cyan); }
.er-row p { grid-column: 2 / 4; color: var(--dim); font-size: .88rem; }
.er-row p b { color: var(--ink); font-weight: 600; }

/* Staging stack */
.stack-wrap { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; }
@media (max-width: 640px) { .stack-wrap { grid-template-columns: 1fr; } }
.stack { display: grid; gap: 4px; }
.stage { display: grid; grid-template-columns: 2.4rem minmax(0, 1fr) 3.6rem; align-items: center; gap: 8px; padding: 5px 8px 5px 0; }
.stage .num { font-family: var(--font-head); font-weight: 700; font-size: .78rem; text-align: center; color: #0a0d10; background: var(--dim); border-radius: 0 3px 3px 0; padding: 3px 0; }
.stage.mod .num { background: var(--cyan); }
.stage.wait .num { background: var(--red); }
.stage .nm { font-size: .82rem; min-width: 0; }
.stage .nm i { display: block; height: 4px; margin-top: 4px; border-radius: 2px; background: currentColor; opacity: .85; }
.stage.stock .nm i { color: var(--dim); } .stage.mod .nm i { color: var(--cyan); } .stage.wait .nm i { color: var(--red); }
.stage .s { font-family: var(--font-mono); text-align: right; font-size: .86rem; }
.stage.wait { background: #ff5b4714; outline: 1px solid #ff5b4755; border-radius: 3px; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: .76rem; color: var(--dim); }
.legend i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 5px; vertical-align: 0; }

.holds { display: grid; gap: 7px; }
.hold { display: grid; grid-template-columns: minmax(0, 1fr) 3.6rem; gap: 2px 8px; font-size: .82rem; }
.hold .gauge { grid-column: 1 / 3; height: 8px; }
.gauge { background: var(--well); border: 1px solid #000; border-radius: 3px; overflow: hidden; display: flex; }
.gauge span { display: block; height: 100%; }
.hold .s { text-align: right; font-family: var(--font-mono); }

/* Resources panel: mods */
.res { display: grid; }
details.r { border-top: 1px solid #ffffff0d; }
details.r:first-child { border-top: 0; }
details.r > summary {
  list-style: none; cursor: pointer; padding: 8px 4px;
  display: grid; grid-template-columns: minmax(0, 18rem) minmax(4rem, 1fr) 7.4rem; gap: 10px; align-items: center;
}
details.r > summary::-webkit-details-marker { display: none; }
details.r > summary:hover { background: #ffffff08; }
details.r[open] > summary { background: #ffffff0a; }
.rname { font-weight: 600; font-size: .86rem; overflow-wrap: anywhere; }
.rname small { display: block; color: var(--dim); font-weight: 400; font-size: .72rem; }
.rgauge { height: 14px; }
.rgauge .m { background: linear-gradient(180deg, #c3f56a, #7fb92a); }
.rgauge .l { background: repeating-linear-gradient(135deg, #a3e23a88 0 3px, transparent 3px 7px); }
.rval { text-align: right; font-family: var(--font-mono); font-size: .86rem; }
@media (max-width: 560px) {
  details.r > summary { grid-template-columns: minmax(0, 1fr) 7.4rem; }
  details.r > summary .rgauge { grid-column: 1 / 3; grid-row: 2; }
}
.rbody { padding: 6px 6px 14px; display: grid; gap: 12px; }
.fnd { display: grid; gap: 5px; padding: 10px 12px; }
.fnd h4 { font-size: .92rem; }
.fnd .act { font-size: .86rem; }
.fnd .how { font-size: .76rem; color: var(--dim); }
.chip { display: inline-block; font: 600 .66rem var(--font-head); letter-spacing: .08em; text-transform: uppercase; padding: 1px 6px; border-radius: 3px; margin-left: 6px; vertical-align: 1px; }
.chip.fix { background: var(--red); color: #160604; }
.chip.trade { background: var(--amber); color: #1b1200; }
.chip.likely { border: 1px dashed var(--amber); color: var(--amber); }
.chip.info { border: 1px solid var(--cyan); color: var(--cyan); }
.places { display: flex; flex-wrap: wrap; gap: 3px 10px; font-size: .74rem; color: var(--dim); }
pre.ev { margin: 0; font: .72rem/1.5 var(--font-mono); color: #b9d8a0; padding: 8px 10px; overflow-x: auto; white-space: pre; }

/* Debug console */
details.console > summary { cursor: pointer; list-style: none; }
details.console > summary::-webkit-details-marker { display: none; }
details.console > summary::after { content: "▸"; margin-left: 8px; color: var(--dim); }
details.console[open] > summary::after { content: "▾"; }
.con { font: .78rem/1.6 var(--font-mono); color: #c9d1d9; padding: 10px 12px; overflow-x: auto; }
.con .k { color: var(--dim); }
.con .w { color: var(--amber); }
.con .g { color: var(--green); }
.con table { border-collapse: collapse; width: 100%; }
.con td { padding: 1px 10px 1px 0; vertical-align: top; white-space: nowrap; }
.con td.r { text-align: right; }
.con h4 { font-family: var(--font-mono); font-weight: 400; color: var(--cyan); margin: 10px 0 2px; font-size: .78rem; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
/* Raw data tab: the debug console, every number T-Minus read */
.tabs.raw { --tab-c: var(--ink); }
#tab-raw .mono { color: var(--dim); }
.part.raw .banner { border-color: var(--ink); }
.part.raw .banner .mono { color: var(--dim); font-size: 1rem; }
.rawsearch { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.rawsearch input, .rt-tools input { flex: 1 1 14rem; min-width: 0; background: var(--well); color: var(--ink); border: 1px solid #000; border-radius: 4px;
  box-shadow: inset 0 1px 3px #000a; padding: 7px 10px; font: .85rem var(--font-mono); }
.rawsearch input:focus, .rt-tools input:focus { outline: 1px solid var(--green); }
.rawsearch .rt-count { flex-basis: 100%; }
.rawidx { display: flex; flex-wrap: wrap; gap: 6px; }
.rawgrp { display: grid; gap: 10px; }
.rawgrp > h3 { font: 700 .95rem var(--font-head); letter-spacing: .1em; color: var(--dim); border-bottom: 1px solid #ffffff1a; padding-bottom: 4px; scroll-margin-top: 12px; }
details.rawsec > summary { cursor: pointer; list-style: none; flex-wrap: wrap; gap: 4px 8px; }
details.rawsec > summary::-webkit-details-marker { display: none; }
details.rawsec > summary > span:first-child::before { content: "▸ "; color: var(--dim); }
details.rawsec[open] > summary > span:first-child::before { content: "▾ "; }
details.rawsec.nomatch { opacity: .45; }
.rawnote { color: var(--dim); font-size: .82rem; max-width: 68ch; }
.src { font: .66rem var(--font-mono); letter-spacing: .04em; border: 1px solid currentColor; border-radius: 3px; padding: 0 5px; text-transform: none; }
.src.p { color: var(--cyan); }
.src.l { color: var(--amber); }
.src.a { color: var(--green); }
.rt-tools { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.rt-count { color: var(--dim); font: .74rem var(--font-mono); }
.rt-wrap { overflow-x: auto; max-height: 34rem; overflow-y: auto; padding: 0 10px 6px; }
table.rt { border-collapse: collapse; width: 100%; font: .76rem/1.45 var(--font-mono); color: #c9d1d9; }
.rt th { position: sticky; top: 0; background: var(--well); text-align: left; color: var(--dim); font-weight: 400; border-bottom: 1px solid #ffffff22; padding: 6px 12px 4px 0; white-space: nowrap; }
.rt th.n { text-align: right; }
.rt th button { all: unset; cursor: pointer; }
.rt th button:focus-visible { outline: 1px solid var(--green); }
.rt th[aria-sort="descending"] button::after { content: " ▾"; color: var(--green); }
.rt th[aria-sort="ascending"] button::after { content: " ▴"; color: var(--green); }
.rt td { padding: 2px 12px 2px 0; border-bottom: 1px solid #ffffff08; vertical-align: top; }
.rt td.n { text-align: right; white-space: nowrap; }
.rt td.wrap { overflow-wrap: anywhere; min-width: 16rem; }
.rt td.dim { color: var(--dim); }
.rt mark { background: #a3e23a33; color: inherit; }
.rt-more { display: flex; gap: 8px; flex-wrap: wrap; }
.kbtn.sm { padding: 4px 10px; font-size: .72rem; }
.kv { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 3px 16px; font: .78rem/1.5 var(--font-mono); color: #c9d1d9; padding: 10px 12px; margin: 0; }
.kv dt { color: var(--dim); }
.kv dd { margin: 0; overflow-wrap: anywhere; }
.fdl { display: grid; gap: 6px; }
details.fd { border-top: 1px solid #ffffff0d; padding-top: 6px; }
details.fd > summary { cursor: pointer; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 10px; font-size: .86rem; }
details.fd > summary small { grid-column: 1 / -1; color: var(--dim); font: .72rem var(--font-mono); }
details.fd .kv { padding: 8px 0; }
.more-row { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; align-items: center; padding: 8px 10px; color: var(--dim); font-size: .8rem; border-top: 1px dashed #ffffff1a; }
.part[hidden] { display: none; }
.gloss { font-family: var(--font-body); font-weight: 400; text-transform: none; letter-spacing: 0; font-size: .8em; opacity: .75; }
/* Two-part report: section banners and per-Hold breakdown */
.tabs { display: flex; gap: 4px; flex-wrap: wrap; border-bottom: 2px solid var(--tab-c, var(--green)); margin-bottom: -8px; }
.tab { appearance: none; cursor: pointer; display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; padding: 8px 12px 7px; border: 1px solid #ffffff1f; border-bottom: 0; border-radius: 6px 6px 0 0;
  background: linear-gradient(#262b31, #1a1e23); color: var(--dim); font: 700 .95rem var(--font-head); letter-spacing: .08em; text-align: left; }
.tab .mono { font: 1rem var(--font-mono); letter-spacing: 0; }
.tab:hover { color: var(--ink); }
.tab[aria-selected="true"] { color: var(--ink); background: linear-gradient(var(--panel-top), var(--panel-bot)); border-color: var(--tab-c, var(--green)); box-shadow: inset 0 2px 0 var(--tab-c, var(--green)); }
.tab:focus-visible { outline: 2px solid var(--tab-c, var(--green)); outline-offset: 2px; }
#tab-startup .mono { color: var(--green); }
#tab-transitions .mono { color: var(--cyan); }
.tabs.tr { --tab-c: var(--cyan); }
.clocks { display: flex; gap: 10px; flex-wrap: wrap; }
.part { display: grid; gap: 16px; scroll-margin-top: 12px; }
.banner { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; padding: 4px 2px 8px; border-bottom: 2px solid var(--green); }
.banner h2 { font-size: clamp(1.5rem, 5vw, 2rem); letter-spacing: .08em; }
.banner .mono { font-size: 1.4rem; color: var(--green); }
.banner p { flex-basis: 100%; color: var(--dim); font-size: .86rem; }
.part.tr .banner { border-color: var(--cyan); }
.part.tr .banner .mono { color: var(--cyan); }
details.hd { border-top: 1px solid #ffffff0d; }
details.hd:first-child { border-top: 0; }
details.hd > summary { list-style: none; cursor: pointer; padding: 8px 6px; display: grid; grid-template-columns: minmax(0, 13rem) minmax(0, 1fr) 4rem; gap: 10px; align-items: center; font-size: .86rem; }
details.hd > summary::-webkit-details-marker { display: none; }
details.hd > summary:hover, details.hd[open] > summary { background: #ffffff08; }
details.hd .s { text-align: right; font-family: var(--font-mono); }
details.hd .gauge { height: 12px; }
.hd-body { padding: 4px 10px 12px; display: grid; gap: 4px; font-size: .82rem; }
.hd-row { display: grid; grid-template-columns: minmax(0, 1fr) 5.5rem; gap: 8px; }
.hd-row .s { text-align: right; font-family: var(--font-mono); }
.hd-row.likely span:first-child::after { content: " (likely)"; color: var(--amber); font-size: .74rem; }
.hd-sub { color: var(--dim); margin-top: 6px; font-size: .76rem; text-transform: uppercase; letter-spacing: .08em; font-family: var(--font-head); }
@media (max-width: 560px) {
  details.hd > summary { grid-template-columns: minmax(0, 1fr) 4rem; }
  details.hd > summary .gauge { grid-column: 1 / 3; grid-row: 2; }
}
.part[hidden] { display: none; }
/* Added for the generated report */
[hidden] { display: none !important; }
.rgauge .w { background: repeating-linear-gradient(135deg, #7e8a9455 0 2px, transparent 2px 6px); }
.rval small { display: block; color: var(--dim); font-size: .72rem; }
.notice { font-size: .82rem; color: var(--amber); border: 1px dashed #ffb02e66; padding: 7px 11px; border-radius: 5px; }
.notice ul { margin: 4px 0 0; padding-left: 18px; color: var(--dim); }
.within { font-size: .76rem; color: var(--dim); }
`;
