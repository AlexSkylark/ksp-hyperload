// The report's behavior, inlined into the rendered page and its saved copy:
// tabs, Copy summary, Download, and the Raw data tools (sort, filter, paging,
// one search over every table). Ported from mockup v5's script. It only
// enhances the static page: without JavaScript every part stays visible, one
// after the other, and every raw row is shown.

declare global {
  interface Window {
    /** The page Download saves, set by the template before it replaced the document. */
    tminusDownload?: string;
    /** That page's file name. */
    tminusDownloadName?: string;
  }
}

/** Rows a raw table shows before "Show more". */
const PAGE = 25;
/** "Show more" adds this many rows. */
const MORE = 50;

const rowsText = (n: number) => `${n.toLocaleString("en")} row${n === 1 ? "" : "s"}`;

const $ = (id: string) => document.getElementById(id);

// The saved copy has no analyzer: Download saves the page as it arrived.
const pristine = `<!doctype html>\n${document.documentElement.outerHTML}`;

// ---------------------------------------------------------------- tabs

const tabList = $("tabs");
const tabs = [...document.querySelectorAll<HTMLButtonElement>(".tab")];

function openTab(id: string, focus = false): void {
  if (!tabs.some((t) => t.getAttribute("aria-controls") === id)) return;
  for (const t of tabs) {
    const on = t.getAttribute("aria-controls") === id;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    const panel = $(t.getAttribute("aria-controls") ?? "");
    if (panel) panel.hidden = !on;
    if (on && focus) t.focus();
  }
  tabList?.classList.toggle("tr", id === "transitions");
  tabList?.classList.toggle("raw", id === "raw");
}

if (tabList && tabs.length) {
  tabList.hidden = false;
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => openTab(t.getAttribute("aria-controls") ?? ""));
    t.addEventListener("keydown", (e) => {
      const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (d) openTab(tabs[(i + d + tabs.length) % tabs.length].getAttribute("aria-controls") ?? "", true);
    });
  });
  const wanted = location.hash.slice(1);
  openTab(wanted === "transitions" || wanted === "raw" ? wanted : "startup");
}

// ---------------------------------------------------------------- Copy summary, Download

const toast = $("toast");
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function say(message: string): void {
  if (!toast) return;
  toast.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.textContent = ""), 4000);
}

/** The Clipboard API, or a selected text area where it is missing or refused (some browsers on file://). */
async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

const summaryText = (() => {
  try {
    const v: unknown = JSON.parse($("tminus-summary")?.textContent ?? "null");
    return typeof v === "string" ? v : undefined;
  } catch {
    return undefined;
  }
})();

/** The saved copy's own file name, or a fixed one. */
function downloadName(): string {
  if (window.tminusDownloadName) return window.tminusDownloadName;
  const own = decodeURIComponent(location.pathname.split("/").pop() ?? "");
  return /\.html?$/i.test(own) ? own : "tminus-report.html";
}

const buttons = document.querySelector<HTMLElement>(".btns");
if (buttons) {
  buttons.hidden = false;
  const hint = document.querySelector<HTMLElement>(".hint");
  if (hint) hint.hidden = false;

  $("btn-summary")?.addEventListener("click", () => {
    if (!summaryText) return say("This page has no summary to copy");
    void copy(summaryText).then((ok) =>
      say(ok ? `Summary copied: ${summaryText.length} characters, fits one Discord or forum message` : "Copy is blocked here: select the text by hand"),
    );
  });

  $("btn-download")?.addEventListener("click", () => {
    const html = window.tminusDownload ?? pristine;
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = downloadName();
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    say(window.tminusDownload ? "Saved without your log and without the Raw data tab: this is the file to share" : "Saved");
  });
}

// ---------------------------------------------------------------- raw data

interface RawTable {
  /** Applies a filter and returns how many rows match. */
  setFilter(q: string): number;
}

const numeric = (cell: HTMLTableCellElement) => cell.classList.contains("n");
const cellNumber = (cell: HTMLTableCellElement | undefined) => {
  const v = Number.parseFloat((cell?.textContent ?? "").replace(/,/g, ""));
  return Number.isNaN(v) ? -Infinity : v;
};

/** Sort, filter and paging on one static table, as mockup v5 had them. */
function enhanceTable(box: HTMLElement): RawTable | undefined {
  const table = box.querySelector("table");
  const body = table?.tBodies[0];
  const heads = [...(table?.tHead?.rows[0]?.cells ?? [])];
  if (!table || !body || !heads.length) return undefined;

  const rows = [...body.rows];
  const nums = heads.map((h) => numeric(h));
  // Filters match the text columns: numbers would match almost any digit typed.
  const text = rows.map((r) =>
    [...r.cells]
      .filter((_, i) => !nums[i])
      .map((c) => c.textContent ?? "")
      .join(" ")
      .toLowerCase(),
  );
  const keys = rows.map((r) => [...r.cells].map((c, i) => (nums[i] ? cellNumber(c) : (c.textContent ?? ""))));
  const original = rows.map((_, i) => i);

  // The static count becomes part of the tools above the table.
  const staticCount = box.querySelector(":scope > .rt-count");
  const tools = document.createElement("div");
  tools.className = "rt-tools";
  const input = document.createElement("input");
  input.type = "search";
  input.placeholder = rows.length === 1 ? "Filter this row" : `Filter these ${rows.length.toLocaleString("en")} rows`;
  input.setAttribute("aria-label", "Filter rows");
  const count = document.createElement("span");
  count.className = "rt-count";
  tools.append(input, count);
  box.prepend(tools);
  staticCount?.remove();
  const more = document.createElement("div");
  more.className = "rt-more";
  box.append(more);

  heads.forEach((h, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.i = String(i);
    b.append(...h.childNodes);
    h.append(b);
  });

  let sort = -1; // -1: the order the report wrote
  let desc = true;
  let shown = PAGE;
  let q = "";
  let matches = original;

  function draw(): void {
    const list =
      sort < 0
        ? matches
        : matches.slice().sort((a, b) => {
            const x = keys[a][sort];
            const y = keys[b][sort];
            const d = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
            return (desc ? -d : d) || a - b;
          });
    const visible = new Set(list.slice(0, shown));
    // Reorder only when sorted; hide what is filtered out or past the page.
    if (sort >= 0) {
      const listed = new Set(list);
      body!.append(...list.map((i) => rows[i]), ...original.filter((i) => !listed.has(i)).map((i) => rows[i]));
    }
    rows.forEach((r, i) => (r.hidden = !visible.has(i)));
    heads.forEach((h, i) => (i === sort ? h.setAttribute("aria-sort", desc ? "descending" : "ascending") : h.removeAttribute("aria-sort")));
    count.textContent = q ? `${matches.length.toLocaleString("en")} of ${rowsText(rows.length)} match` : rowsText(rows.length);
    const left = list.length - Math.min(shown, list.length);
    more.replaceChildren();
    if (left > 0) {
      const add = (label: string, m: string) => {
        const b = document.createElement("button");
        b.className = "kbtn sm";
        b.type = "button";
        b.dataset.m = m;
        b.textContent = label;
        more.append(b);
      };
      add(`SHOW ${Math.min(MORE, left)} MORE`, String(MORE));
      add(`SHOW ALL ${list.length.toLocaleString("en")}`, "all");
      const note = document.createElement("span");
      note.className = "rt-count";
      note.textContent = `${left.toLocaleString("en")} not shown`;
      more.append(note);
    }
  }

  function setFilter(s: string): number {
    q = s.trim().toLowerCase();
    input.value = s;
    matches = q ? original.filter((i) => text[i].includes(q)) : original;
    shown = PAGE;
    draw();
    return matches.length;
  }

  input.addEventListener("input", () => setFilter(input.value));
  table.tHead!.addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>("button");
    if (!b) return;
    const i = Number(b.dataset.i);
    if (i === sort) desc = !desc;
    else {
      sort = i;
      desc = nums[i];
    }
    draw();
  });
  more.addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>("button");
    if (!b) return;
    shown = b.dataset.m === "all" ? Infinity : shown + MORE;
    draw();
  });
  draw();
  return { setFilter };
}

const raw = $("raw");
if (raw) {
  const sections = [...raw.querySelectorAll<HTMLDetailsElement>("details.rawsec")].map((d) => ({
    d,
    tables: [...d.querySelectorAll<HTMLElement>(".rt-box")].map(enhanceTable).filter((t): t is RawTable => t !== undefined),
  }));
  const tableCount = sections.reduce((n, s) => n + s.tables.length, 0);
  const rowTotal = raw.querySelectorAll(".rt tbody tr").length;
  const search = raw.querySelector<HTMLElement>("section.win[hidden]");
  if (search) search.hidden = false;
  const counter = $("raw-count");
  const idle = `${sections.length} sections, ${tableCount} tables, ${rowTotal.toLocaleString("en")} rows. Type a mod, folder, class or event to filter every table at once.`;
  if (counter) counter.textContent = idle;

  $("raw-idx")?.addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>("button");
    if (b?.dataset.to) $(b.dataset.to)?.scrollIntoView({ behavior: "smooth" });
  });

  const query = $("raw-q") as HTMLInputElement | null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const runSearch = () => {
    const q = query?.value.trim() ?? "";
    let hits = 0;
    for (const s of sections) {
      if (!s.tables.length) continue;
      const m = s.tables.reduce((n, t) => n + t.setFilter(q), 0);
      hits += m;
      s.d.classList.toggle("nomatch", Boolean(q) && !m);
      if (q) s.d.open = m > 0;
    }
    if (counter) counter.textContent = q ? `${hits.toLocaleString("en")} rows match "${q}"; sections with matches are open.` : idle;
  };
  query?.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(runSearch, 150);
  });

  // "Open raw data" under a ranked list: the rest of that list is in the tab.
  for (const b of document.querySelectorAll<HTMLElement>("[data-raw]")) b.hidden = false;
  document.addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>("[data-raw]");
    if (!b) return;
    openTab("raw");
    if (query && b.dataset.raw) {
      query.value = b.dataset.raw;
      runSearch();
    }
    raw.scrollIntoView({ behavior: "smooth" });
  });
}

export {};
