import { css, customElement, html, LitElement, nothing, property, state, type PropertyValues, type TemplateResult } from "@umbraco-cms/backoffice/external/lit";
import { api, backofficeOrigin, editUrl, thumbnail, typeUrl } from "./api.js";
import {
  changedAncestors,
  children,
  getAt,
  guidKind,
  isContainer,
  isGuid,
  isImageUrl,
  matches,
  parsePath,
  pathKey,
  search,
  type Change,
  type ItemKind,
  type Json,
  type Segment,
} from "./json.js";

export interface TreeHits {
  count: number;
  /** The current hit, from 0; -1 when there are none. */
  index: number;
  /** Whether the query is a path that resolved, rather than text to search for. */
  path: boolean;
}

/**
 * A Delivery API response as a tree: open to a depth, filtered by a search, and with draft against
 * published marked when given changes. Colours come from the backoffice's UUI tokens, so it follows the light, dark and high contrast themes.
 */
@customElement("thebuilder-json-tree")
export class JsonTreeElement extends LitElement {
  @property({ attribute: false }) data: Json = null;
  /** Draft against published, by path. When set, the tree opens exactly the changed branches. */
  @property({ attribute: false }) changes?: Map<string, Change>;
  /** How a changed value shows: as a removed and an added line (diff), or old and new on one line (inline). */
  @property() changeStyle: "diff" | "inline" = "diff";
  /** How many levels are open, where a row has not been opened or closed by hand. */
  @property({ type: Number }) depth = 3;
  /** Text to search keys and values for, or a path such as properties.image[0].url to jump to. */
  @property() query = "";
  /** Document and media type keys by alias, so a type badge can open its type. */
  @property({ attribute: false }) types?: { document: Record<string, string> | null; media: Record<string, string> | null };

  @state() private _overrides = new Map<string, boolean>();
  @state() private _hit = 0;
  @state() private _thumb?: { key: string; src: string; top: number; left: number };
  @state() private _kinds = new Map<string, ItemKind>();

  #hits: Segment[][] = [];
  #keep = new Set<string>();
  #jump?: Segment[];
  #changedOpen = new Set<string>();
  #removedByParent = new Map<string, [Segment, Change][]>();

  /** Closes and opens rows by hand again from the depth. */
  reset(): void {
    this._overrides = new Map();
  }

  next(step = 1): void {
    if (this.#hits.length) {
      this._hit = (this._hit + step + this.#hits.length) % this.#hits.length;
    }
  }

  protected willUpdate(changed: PropertyValues): void {
    if (changed.has("data") || changed.has("depth") || changed.has("changes")) {
      this._overrides = new Map();
    }
    if (changed.has("data")) {
      void this.#resolveKinds();
    }
    if (changed.has("changes")) {
      this.#changedOpen = this.changes ? changedAncestors(this.changes) : new Set();
      this.#removedByParent = new Map();
      for (const [key, change] of this.changes ?? []) {
        if (change.kind !== "removed") continue;
        const path = JSON.parse(key) as Segment[];
        const parent = pathKey(path.slice(0, -1));
        this.#removedByParent.set(parent, [...(this.#removedByParent.get(parent) ?? []), [path[path.length - 1], change]]);
      }
    }
    if (changed.has("data") || changed.has("query")) {
      const path = parsePath(this.query);
      this.#jump = path && path.length && getAt(this.data, path) !== undefined ? path : undefined;
      const result = this.#jump ? { hits: [this.#jump], keep: new Set<string>() } : search(this.data, this.query.trim());
      this.#hits = result.hits;
      this.#keep = result.keep;
      if (this.#jump) {
        this._overrides = new Map(this._overrides);
        for (let length = 0; length < this.#jump.length; length++) {
          this._overrides.set(pathKey(this.#jump.slice(0, length)), true);
        }
      }
      this._hit = 0;
    }
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has("_thumb")) {
      const image = this.renderRoot.querySelector<HTMLElement>("img.thumb");
      if (image && !image.matches(":popover-open")) image.showPopover?.();
    }
    if (changed.has("_hit") || changed.has("query") || changed.has("data")) {
      const hits: TreeHits = { count: this.#hits.length, index: this.#hits.length ? this._hit : -1, path: !!this.#jump };
      this.dispatchEvent(new CustomEvent("hits", { detail: hits }));
      if (this.#hits.length) {
        this.renderRoot.querySelector(".row.current")?.scrollIntoView({ block: "nearest" });
      }
    }
  }

  /** GUIDs whose place in the response does not say what they are, looked up once per response. */
  async #resolveKinds(): Promise<void> {
    const unknown = new Set<string>();
    const walk = (value: Json, parent: Json | undefined, key: Segment | undefined, parentKey: Segment | undefined) => {
      if (isGuid(value) && key !== undefined && !guidKind(parent, key, parentKey)) {
        unknown.add(value.toLowerCase());
      } else if (isContainer(value)) {
        for (const [childKey, child] of children(value)) walk(child, value, childKey, key);
      }
    };
    walk(this.data, undefined, undefined, undefined);
    if (unknown.size) {
      const data = this.data;
      const kinds = await api.kinds([...unknown].slice(0, 200));
      if (this.data === data) {
        this._kinds = kinds;
      }
    }
  }

  /** Shows a small version of an image beside its URL, in the top layer so the tree's scrolling never clips it. */
  async #showThumb(event: MouseEvent, key: string, parent: Json, url: string): Promise<void> {
    const row = event.currentTarget as HTMLElement;
    const value = row.querySelector(".string") ?? row;
    const rect = value.getBoundingClientRect();
    const id = isContainer(parent) && !Array.isArray(parent) && typeof parent.id === "string" ? parent.id : undefined;
    const src = (id && (await thumbnail(id))) || absolute(url);
    if (!row.matches(":hover")) return;
    const below = rect.bottom + 172 < window.innerHeight;
    this._thumb = { key, src, left: rect.left, top: below ? rect.bottom + 4 : rect.top - 168 };
  }

  #isOpen(path: Segment[], level: number): boolean {
    const key = pathKey(path);
    const override = this._overrides.get(key);
    if (override !== undefined) return override;
    if (this.query.trim() && !this.#jump) return this.#keep.has(key);
    if (this.changes) return this.#changedOpen.has(key);
    return level < this.depth;
  }

  #toggle(event: MouseEvent, path: Segment[], value: Json, open: boolean): void {
    const overrides = new Map(this._overrides);
    overrides.set(pathKey(path), !open);
    // Alt-click opens or closes the whole branch.
    if (event.altKey) {
      const walk = (current: Json, at: Segment[]) => {
        if (!isContainer(current)) return;
        overrides.set(pathKey(at), !open);
        for (const [key, child] of children(current)) walk(child, [...at, key]);
      };
      walk(value, path);
    }
    this._overrides = overrides;
  }

  #onKeydown(event: KeyboardEvent): void {
    const rows = [...this.renderRoot.querySelectorAll<HTMLElement>(".row[data-path]")];
    const index = rows.indexOf(event.composedPath()[0] as HTMLElement);
    if (index < 0) return;
    const move = (to: number) => {
      event.preventDefault();
      rows[Math.max(0, Math.min(rows.length - 1, to))]?.focus();
    };
    if (event.key === "ArrowDown") move(index + 1);
    else if (event.key === "ArrowUp") move(index - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(rows.length - 1);
    else if (event.key === "ArrowRight" || event.key === "ArrowLeft" || event.key === "Enter") {
      const toggle = rows[index].querySelector<HTMLButtonElement>(".chevron");
      const open = rows[index].getAttribute("aria-expanded") === "true";
      if (toggle && (event.key === "Enter" || open === (event.key === "ArrowLeft"))) {
        event.preventDefault();
        toggle.click();
      }
    }
  }

  async #copy(event: Event, value: Json): Promise<void> {
    event.stopPropagation();
    const text = isContainer(value) ? JSON.stringify(value, null, 2) : String(value);
    try {
      await navigator.clipboard.writeText(text);
      this.dispatchEvent(new CustomEvent("copied", { detail: isContainer(value) ? `Copied the ${Array.isArray(value) ? "array" : "object"}.` : "Copied the value." }));
    } catch {
      this.dispatchEvent(new CustomEvent("copied", { detail: "The browser blocked copying." }));
    }
  }

  /** The content or media type an object is, as a badge that opens the type where the user can edit it. */
  #tag(value: { [key: string]: Json }) {
    const alias = typeof value.contentType === "string" ? value.contentType : typeof value.mediaType === "string" ? value.mediaType : undefined;
    if (!alias) return nothing;
    const media = typeof value.contentType !== "string";
    const key = (media ? this.types?.media : this.types?.document)?.[alias];
    if (!key) return html`<span class="tag" data-text=${alias}></span>`;
    return html`<a class="tag" data-text=${alias} href=${typeUrl(media ? "media-type" : "document-type", key)} target="_blank" rel="noopener"
      title=${`Open the ${alias} ${media ? "media" : "document"} type`} aria-label=${`Open the ${alias} ${media ? "media" : "document"} type`}></a>`;
  }

  /** Lights up one pair of brackets, as an editor does at the cursor, without rendering the tree again. */
  #pair(id: number | undefined): void {
    const style = this.renderRoot.querySelector<HTMLStyleElement>("style.pair");
    if (style) style.textContent = id === undefined ? "" : `.bracket[data-pair="${id}"] { background: var(--json-pair); box-shadow: 0 0 0 1px var(--json-pair-border); border-radius: 2px; }`;
  }

  render() {
    if (!isContainer(this.data)) {
      return html`<div class="tree" role="tree">${this.#value(null, this.data, [], undefined, undefined)}</div>`;
    }
    const rows: TemplateResult[] = [];
    const current = this.#hits.length ? pathKey(this.#hits[this._hit]) : undefined;
    const searching = !!this.query.trim() && !this.#jump;
    const brackets = (value: Json[] | object): [string, string] => (Array.isArray(value) ? ["[", "]"] : ["{", "}"]);
    // Line numbers are the lines of the formatted JSON, so a closed or filtered branch skips its lines
    // as a fold in an editor does. Lines only in published have no number.
    let line = 1;
    let pairs = 0;
    const lead = (number: number | undefined, fold: unknown = nothing) =>
      html`<span class="ln" aria-hidden="true">${number ?? ""}</span><span class="sign" aria-hidden="true"></span><span class="fold">${fold}</span>`;
    const bracket = (text: string, depth: number, pair: number) => html`<span class="bracket b${depth % 3}" data-pair=${pair}>${text}</span>`;
    const comma = (last: boolean) => (last ? nothing : html`<span class="punct">,</span>`);
    // Shows on hover, right after the line's own content, so it sits next to what it copies.
    const copy = (key: Segment, value: Json) => html`<button type="button" class="copy" tabindex="-1" aria-label=${`Copy ${key}`} title=${isContainer(value) ? "Copy as JSON" : "Copy value"}
      @click=${(event: Event) => { (event.currentTarget as HTMLElement).blur(); void this.#copy(event, value); }}><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 3.5v-.5A1.5 1.5 0 0 0 9 1.5H4A1.5 1.5 0 0 0 2.5 3v5A1.5 1.5 0 0 0 4 9.5h.5" /></svg></button>`;

    const walk = (key: Segment, value: Json, path: Segment[], level: number, parent: Json, parentKey: Segment | undefined, last: boolean) => {
      const keyString = pathKey(path);
      if (searching && !this.#keep.has(keyString)) {
        line += lineCount(value);
        return;
      }
      const change = this.changes?.get(keyString);
      // In diff style a changed value is a published line taken away and a draft line added.
      const asLines = change?.kind === "changed" && this.changeStyle === "diff" && !isContainer(value);
      const hit = (searching && matches(key, value, this.query.trim())) || (this.#jump && keyString === pathKey(this.#jump));
      const classes = ["row", asLines ? "added" : change?.kind ?? "", hit ? "hit" : "", keyString === current ? "current" : ""].join(" ");
      const keyLabel = typeof key === "number"
        ? html`<span class="index">${key}</span><span class="punct colon">:</span>`
        : html`<span class="key">${this.#highlight(JSON.stringify(key))}</span><span class="punct colon">:</span>`;
      const before = change?.kind === "changed" && !asLines ? html`<span class="before" title="Published">${preview(change.before)}</span>` : nothing;

      if (!isContainer(value)) {
        if (asLines) {
          rows.push(html`<div class="row removed" role="treeitem" aria-level=${level} aria-label="Published" style="--level:${level}">
            ${lead(undefined)}<span class="code">${keyLabel}<span class="before">${preview(change.before)}</span>${comma(last)}</span>
          </div>`);
        }
        rows.push(html`<div class=${classes} data-path=${keyString} role="treeitem" aria-level=${level} tabindex="-1" style="--level:${level}"
          @mouseenter=${isImageUrl(parent, key, value) ? (event: MouseEvent) => this.#showThumb(event, keyString, parent, value) : nothing}
          @mouseleave=${isImageUrl(parent, key, value) ? () => (this._thumb = undefined) : nothing}>
          ${lead(line++)}<span class="code">${keyLabel}${before}${this.#value(key, value, path, parent, parentKey)}${comma(last)}${copy(key, value)}</span>
        </div>`);
        return;
      }

      const entries = children(value);
      const open = entries.length > 0 && this.#isOpen(path, level);
      const [start, end] = brackets(value);
      const pair = ++pairs;
      const tag = Array.isArray(value) ? nothing : this.#tag(value);
      const count = Array.isArray(value) && entries.length ? html`<span class="meta" data-text=${`${entries.length} ${entries.length === 1 ? "item" : "items"}`}></span>` : nothing;
      const toggle = (event: MouseEvent) => this.#toggle(event, path, value, open);
      const fold = entries.length
        ? html`<button type="button" class="chevron" data-open=${String(open)} tabindex="-1" aria-label=${open ? "Close" : "Open"} title="Alt-click opens or closes everything inside" @click=${toggle}>
            <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 2l3 3-3 3" /></svg></button>`
        : nothing;
      rows.push(html`<div class=${classes} data-path=${keyString} role="treeitem" aria-level=${level} aria-expanded=${entries.length ? String(open) : nothing} tabindex="-1" style="--level:${level}"
        @mouseenter=${() => this.#pair(pair)} @mouseleave=${() => this.#pair(undefined)}>
        ${lead(line, fold)}<span class="code">${entries.length ? html`<span class="toggle" @click=${toggle}>${keyLabel}</span>` : keyLabel}${before}<span class=${entries.length ? "toggle" : ""} @click=${entries.length ? toggle : nothing}>${bracket(start, level, pair)}${open ? nothing : html`${entries.length ? html`<span class="ellipsis" data-text="…"></span>` : nothing}${bracket(end, level, pair)}`}</span>${open ? nothing : comma(last)}${count}${tag}${entries.length ? copy(key, value) : nothing}</span>
      </div>`);
      if (!open) {
        line += lineCount(value);
        return;
      }
      line++;
      entries.forEach(([childKey, child], index) => walk(childKey, child, [...path, childKey], level + 1, value, key, index === entries.length - 1));
      for (const [removedKey, removed] of this.#removedByParent.get(keyString) ?? []) {
        rows.push(html`<div class="row removed" role="treeitem" aria-level=${level + 1} style="--level:${level + 1}">
          ${lead(undefined)}<span class="code"><span class="key">${typeof removedKey === "number" ? removedKey : JSON.stringify(removedKey)}</span><span class="punct colon">:</span><span class="before">${preview(removed.before)}</span><span class="meta" data-text="Only in published"></span></span>
        </div>`);
      }
      rows.push(html`<div class="row close" aria-hidden="true" style="--level:${level}" @mouseenter=${() => this.#pair(pair)} @mouseleave=${() => this.#pair(undefined)}>
        ${lead(line++)}<span class="code">${bracket(end, level, pair)}${comma(last)}</span></div>`);
    };

    // The response itself, so the top-level keys sit inside its braces as they do in the JSON.
    const [rootStart, rootEnd] = brackets(this.data);
    const total = lineCount(this.data);
    const rootPair = ++pairs;
    rows.push(html`<div class="row root" aria-hidden="true" style="--level:0" @mouseenter=${() => this.#pair(rootPair)} @mouseleave=${() => this.#pair(undefined)}>
      ${lead(line++)}<span class="code">${bracket(rootStart, 0, rootPair)}</span></div>`);
    const top = children(this.data);
    top.forEach(([key, child], index) => walk(key, child, [key], 1, this.data, undefined, index === top.length - 1));
    for (const [removedKey, removed] of this.#removedByParent.get(pathKey([])) ?? []) {
      rows.push(html`<div class="row removed" style="--level:1">${lead(undefined)}<span class="code"><span class="key">${JSON.stringify(removedKey)}</span><span class="punct colon">:</span><span class="before">${preview(removed.before)}</span><span class="meta" data-text="Only in published"></span></span></div>`);
    }
    rows.push(html`<div class="row root" aria-hidden="true" style="--level:0" @mouseenter=${() => this.#pair(rootPair)} @mouseleave=${() => this.#pair(undefined)}>
      ${lead(total)}<span class="code">${bracket(rootEnd, 0, rootPair)}</span></div>`);
    if (searching && !this.#hits.length) {
      return html`<p class="empty">Nothing matches “${this.query.trim()}”.</p>`;
    }
    const thumb = this._thumb
      ? html`<img class="thumb" popover="manual" alt="" src=${this._thumb.src} style="top:${this._thumb.top}px;left:${this._thumb.left}px" />`
      : nothing;
    return html`${thumb}<style class="pair"></style><div class=${this.changes?.size ? "tree diff" : "tree"} role="tree" aria-label="Delivery API response"
      style="--ln:${String(total).length}ch" @keydown=${this.#onKeydown}
      @focusin=${(event: FocusEvent) => (event.target as HTMLElement).setAttribute("tabindex", "0")}
      @focusout=${(event: FocusEvent) => (event.target as HTMLElement).setAttribute("tabindex", "-1")}>
      ${rows}
    </div>`;
  }

  #value(key: Segment | null, value: Json, _path: Segment[], parent: Json | undefined, parentKey: Segment | undefined) {
    if (typeof value === "string") {
      const kind = isGuid(value) && key !== null ? (guidKind(parent, key, parentKey) ?? this._kinds.get(value.toLowerCase())) : undefined;
      const text = this.#highlight(JSON.stringify(value));
      if (kind) {
        return html`<a class="string link" href=${editUrl(kind, value)} target="_blank" rel="noopener" title=${`Open this ${kind} in a new tab`}>${text}</a>`;
      }
      return html`<span class="string">${text}</span>`;
    }
    if (typeof value === "number") return html`<span class="number">${this.#highlight(String(value))}</span>`;
    if (typeof value === "boolean") return html`<span class="boolean">${this.#highlight(String(value))}</span>`;
    return html`<span class="null">null</span>`;
  }

  #highlight(text: string) {
    const query = this.#jump ? "" : this.query.trim();
    const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
    if (at < 0) return text;
    return html`${text.slice(0, at)}<mark>${text.slice(at, at + query.length)}</mark>${text.slice(at + query.length)}`;
  }

  static styles = css`
    /* Colours and metrics follow the backoffice's code editor (Monaco's light and dark themes), so
       the tree reads like the JSON it is. */
    :host {
      display: block;
      --json-key: #a31515;
      --json-string: #0451a5;
      --json-number: #098658;
      --json-keyword: #0000ff;
      --json-b0: #0431fa;
      --json-b1: #319331;
      --json-b2: #7b3814;
      --json-ln: #237893;
      --json-guide: #d3d3d3;
      --json-pair: rgb(0 100 0 / 0.1);
      --json-pair-border: #b9b9b9;
      --json-line: #eeeeee;
      --json-badge: color-mix(in srgb, var(--uui-color-text, #000) 8%, transparent);
      --json-added: color-mix(in srgb, var(--uui-color-positive, #0b8152) 14%, transparent);
      --json-removed: color-mix(in srgb, var(--uui-color-danger, #d42054) 12%, transparent);
      --json-changed: color-mix(in srgb, var(--uui-color-warning, #fbd142) 22%, transparent);
      --json-mark: color-mix(in srgb, var(--uui-color-warning, #fbd142) 60%, transparent);
      --json-mark-current: var(--uui-color-warning, #fbd142);
      --json-current: color-mix(in srgb, var(--uui-color-selected, #3544b1) 9%, transparent);
      font: 12.5px/20px var(--uui-font-monospace, Menlo, Monaco, "Courier New", monospace);
      color: var(--uui-color-text);
    }
    :host([theme="dark"]) {
      --json-key: #9cdcfe;
      --json-string: #ce9178;
      --json-number: #b5cea8;
      --json-keyword: #569cd6;
      --json-b0: #ffd700;
      --json-b1: #da70d6;
      --json-b2: #179fff;
      --json-ln: #858585;
      --json-guide: #404040;
      --json-pair: rgb(0 100 0 / 0.1);
      --json-pair-border: #888888;
      --json-line: #282828;
    }
    /* The tab's panel scrolls the tree both ways; rows stretch to the widest one so highlights span
       the whole line. */
    .tree {
      padding: var(--uui-size-space-2, 6px) 0;
      width: max-content;
      min-width: 100%;
      box-sizing: border-box;
    }
    /* A row is an editor line: its number, a column for − and + when there are changes, the fold
       arrow, then the code indented two characters a level. */
    .row {
      position: relative;
      display: flex;
      align-items: baseline;
      white-space: nowrap;
      padding-right: var(--uui-size-space-4, 12px);
      outline: none;
    }
    .ln {
      flex: none;
      width: var(--ln);
      padding: 0 4px 0 12px;
      text-align: right;
      color: var(--json-ln);
      user-select: none;
    }
    .sign {
      display: none;
      flex: none;
      width: 14px;
      text-align: center;
      font-weight: 600;
    }
    .tree.diff .sign { display: inline-block; }
    .fold {
      flex: none;
      align-self: stretch;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      margin-right: 4px;
    }
    /* The code, indented two characters a level, with a guide at each level as in the editor. */
    .code {
      display: flex;
      align-items: baseline;
      padding-left: calc(var(--level) * 2ch);
      background-image: repeating-linear-gradient(to right, var(--json-guide) 0 1px, transparent 1px 2ch);
      background-size: calc(var(--level) * 2ch) 100%;
      background-repeat: no-repeat;
      align-self: stretch;
    }
    .row:hover .ln { color: var(--uui-color-text); }
    .row:focus-visible {
      background-color: var(--json-current);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--uui-color-focus) 70%, transparent);
    }
    /* Open arrows show while the pointer is over the tree, closed ones always, as in the editor. */
    button.chevron {
      all: unset;
      display: grid;
      place-items: center;
      width: 16px;
      height: 16px;
      border-radius: 3px;
      cursor: pointer;
      color: var(--uui-color-text-alt);
      transition: opacity 150ms;
    }
    button.chevron svg {
      width: 10px;
      height: 10px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.4;
      stroke-linecap: round;
      stroke-linejoin: round;
      transition: transform 120ms;
    }
    button.chevron[data-open="true"] svg { transform: rotate(90deg); }
    button.chevron[data-open="true"] { opacity: 0; }
    .tree:hover button.chevron, .row:focus-within button.chevron { opacity: 1; }
    button.chevron:hover { color: var(--uui-color-text); background: var(--uui-color-surface-emphasis); }
    .key { color: var(--json-key); }
    .index { color: var(--uui-color-text-alt); }
    .punct { color: var(--uui-color-text); }
    .colon { margin-right: 1ch; }
    .bracket.b0 { color: var(--json-b0); }
    .bracket.b1 { color: var(--json-b1); }
    .bracket.b2 { color: var(--json-b2); }
    .ellipsis {
      margin: 0 2px;
      padding: 0 3px;
      border-radius: 3px;
      line-height: 1.2;
      color: var(--uui-color-text-alt);
      background: var(--json-badge);
    }
    /* Hints drawn from an attribute, so selecting and copying the JSON never picks them up. */
    .meta::after, .tag::after, .ellipsis::after { content: attr(data-text); }
    .meta { margin-left: 8px; font-family: var(--uui-font-family); font-size: 11px; color: var(--uui-color-text-alt); }
    .string { color: var(--json-string); }
    /* GUIDs that open their item read as links by colour, and underline when you point at them. */
    a.link { text-decoration: none; text-underline-offset: 2px; }
    a.link:hover, a.link:focus-visible { text-decoration: underline; }
    .number { color: var(--json-number); }
    .boolean, .null { color: var(--json-keyword); }
    .tag {
      margin-left: 8px;
      padding: 0 7px;
      border-radius: 99px;
      font: 600 10.5px/1.6 var(--uui-font-family);
      background: var(--json-badge);
      color: var(--uui-color-text-alt);
      text-decoration: none;
    }
    a.tag:hover, a.tag:focus-visible {
      background: color-mix(in srgb, var(--uui-color-interactive, #1b264f) 14%, transparent);
      color: var(--uui-color-interactive-emphasis, var(--uui-color-text));
    }
    a.tag:focus-visible { outline: 2px solid var(--uui-color-focus); }
    button.copy {
      all: unset;
      display: inline-grid;
      place-items: center;
      align-self: center;
      width: 18px;
      height: 18px;
      margin-left: 6px;
      border-radius: 3px;
      cursor: pointer;
      color: var(--uui-color-text-alt);
      opacity: 0;
    }
    button.copy svg {
      width: 13px;
      height: 13px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.2;
    }
    .row:hover button.copy, .row:focus-visible button.copy { opacity: 1; }
    button.copy:hover { color: var(--uui-color-text); background: var(--uui-color-surface-emphasis); }
    button.copy:focus-visible { opacity: 1; outline: 2px solid var(--uui-color-focus); }
    /* A container's key and its brackets fold it too, not only the arrow. */
    .toggle {
      cursor: pointer;
    }
    /* With changes, the − and + column tints with its row, as in a code review, and the indent
       guides go a shade darker so they still read on the tint. */
    .added, .removed, .changed {
      background-color: var(--diff-tint);
      --json-guide: color-mix(in srgb, var(--diff-ink) 28%, transparent);
    }
    .added { --diff-tint: var(--json-added); --diff-ink: var(--uui-color-positive, #0b8152); }
    .removed { --diff-tint: var(--json-removed); --diff-ink: var(--uui-color-danger, #d42054); }
    .changed { --diff-tint: var(--json-changed); --diff-ink: var(--uui-color-warning-contrast, #8a5a00); }
    .added .sign::before { content: "+"; color: var(--uui-color-positive); }
    .removed .sign::before { content: "−"; color: var(--uui-color-danger); }
    .changed .sign::before { content: "~"; color: var(--uui-color-warning-contrast, #8a5a00); }
    .before { margin-right: 8px; text-decoration: line-through; color: var(--uui-color-danger); }
    .removed .before { margin-right: 0; text-decoration: none; }
    mark { background: var(--json-mark); color: inherit; border-radius: 2px; }
    /* The search hit Enter moved to: the whole row tinted, and its match in full colour. */
    .current { background-color: var(--json-current); }
    .current mark { background: var(--json-mark-current); }
    .thumb {
      position: fixed;
      inset: auto;
      margin: 0;
      padding: 0;
      max-width: 160px;
      max-height: 160px;
      border-radius: 4px;
      border: 1px solid var(--uui-color-border);
      background: var(--uui-color-surface);
      box-shadow: var(--uui-shadow-depth-3, 0 6px 20px rgb(0 0 0 / 0.2));
      pointer-events: none;
    }
    .empty { margin: 0; padding: var(--uui-size-space-5, 18px); color: var(--uui-color-text-alt); font-family: var(--uui-font-family); }
  `;
}

/** How many lines a value takes in JSON formatted with two-space indents. */
const lineCounts = new WeakMap<object, number>();
const lineCount = (value: Json): number => {
  if (!isContainer(value)) return 1;
  const known = lineCounts.get(value);
  if (known !== undefined) return known;
  const entries = children(value);
  const count = entries.length ? 2 + entries.reduce((sum, [, child]) => sum + lineCount(child), 0) : 1;
  lineCounts.set(value, count);
  return count;
};

const preview = (value: Json | undefined): string => {
  if (value === undefined) return "";
  const text = JSON.stringify(value);
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
};

const absolute = (url: string): string => (/^https?:/i.test(url) ? url : `${backofficeOrigin()}${url}`);

declare global {
  interface HTMLElementTagNameMap {
    "thebuilder-json-tree": JsonTreeElement;
  }
}
