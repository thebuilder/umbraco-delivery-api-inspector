import { css, customElement, html, LitElement, nothing, property, state, type PropertyValues, type TemplateResult } from "@umbraco-cms/backoffice/external/lit";
import { api, backofficeOrigin, editUrl, thumbnail } from "./api.js";
import {
  changedAncestors,
  children,
  formatPath,
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
 * A Delivery API response as a tree: open to a depth, filtered by a search, with copy actions on
 * every row, and with draft against published marked when given changes. Colours come from the
 * backoffice's UUI tokens, so it follows the light, dark and high contrast themes.
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

  async #copy(text: string, message: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.dispatchEvent(new CustomEvent("copied", { detail: message }));
    } catch {
      this.dispatchEvent(new CustomEvent("copied", { detail: "The browser blocked copying." }));
    }
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

  render() {
    if (!isContainer(this.data)) {
      return html`<div class="tree" role="tree">${this.#value(null, this.data, [], undefined, undefined)}</div>`;
    }
    const rows: TemplateResult[] = [];
    const current = this.#hits.length ? pathKey(this.#hits[this._hit]) : undefined;
    const searching = !!this.query.trim() && !this.#jump;
    const brackets = (value: Json[] | object): [string, string] => (Array.isArray(value) ? ["[", "]"] : ["{", "}"]);

    const walk = (key: Segment, value: Json, path: Segment[], level: number, parent: Json, parentKey: Segment | undefined) => {
      const keyString = pathKey(path);
      if (searching && !this.#keep.has(keyString)) return;
      const change = this.changes?.get(keyString);
      // In diff style a changed value is a published line taken away and a draft line added.
      const asLines = change?.kind === "changed" && this.changeStyle === "diff" && !isContainer(value);
      const hit = (searching && matches(key, value, this.query.trim())) || (this.#jump && keyString === pathKey(this.#jump));
      const classes = ["row", asLines ? "added" : change?.kind ?? "", hit ? "hit" : "", keyString === current ? "current" : ""].join(" ");
      const actions = html`<span class="actions">
        <button type="button" @click=${() => this.#copy(formatPath(path), `Copied ${formatPath(path)}`)}>Copy path</button>
        <button type="button" @click=${() => this.#copy(isContainer(value) ? JSON.stringify(value, null, 2) : String(value), "Copied the value")}>Copy value</button>
      </span>`;
      const keyLabel = typeof key === "number"
        ? html`<span class="index">${key}</span><span class="punct colon">:</span>`
        : html`<span class="key">${this.#highlight(JSON.stringify(key))}</span><span class="punct colon">:</span>`;
      const before = change?.kind === "changed" && !asLines ? html`<span class="before" title="Published">${preview(change.before)}</span>` : nothing;

      if (!isContainer(value)) {
        if (asLines) {
          rows.push(html`<div class="row removed" role="treeitem" aria-level=${level} aria-label="Published" style="--level:${level}">
            <span class="gutter"></span>${keyLabel}<span class="before">${preview(change.before)}</span>
          </div>`);
        }
        rows.push(html`<div class=${classes} data-path=${keyString} role="treeitem" aria-level=${level} tabindex="-1" style="--level:${level}"
          @mouseenter=${isImageUrl(parent, key, value) ? (event: MouseEvent) => this.#showThumb(event, keyString, parent, value) : nothing}
          @mouseleave=${isImageUrl(parent, key, value) ? () => (this._thumb = undefined) : nothing}>
          <span class="gutter"></span>${keyLabel}${before}${this.#value(key, value, path, parent, parentKey)}${actions}
        </div>`);
        return;
      }

      const entries = children(value);
      const open = entries.length > 0 && this.#isOpen(path, level);
      const [start, end] = brackets(value);
      const tag = !Array.isArray(value) && typeof (value.contentType ?? value.mediaType) === "string"
        ? html`<span class="tag">${value.contentType ?? value.mediaType}</span>`
        : nothing;
      const count = Array.isArray(value) ? html`<span class="meta">${entries.length} ${entries.length === 1 ? "item" : "items"}</span>` : nothing;
      rows.push(html`<div class=${classes} data-path=${keyString} role="treeitem" aria-level=${level} aria-expanded=${entries.length ? String(open) : nothing} tabindex="-1" style="--level:${level}">
        ${entries.length
          ? html`<button type="button" class="gutter chevron" tabindex="-1" aria-label=${open ? "Close" : "Open"} title="Alt-click opens or closes everything inside"
              @click=${(event: MouseEvent) => this.#toggle(event, path, value, open)}>${open ? "▾" : "▸"}</button>`
          : html`<span class="gutter"></span>`}
        ${keyLabel}${before}<span class="punct">${start}${open ? "" : entries.length ? "…" : ""}${open ? "" : end}</span>${count}${tag}${actions}
      </div>`);
      if (!open) return;
      for (const [childKey, child] of entries) walk(childKey, child, [...path, childKey], level + 1, value, key);
      for (const [removedKey, removed] of this.#removedByParent.get(keyString) ?? []) {
        rows.push(html`<div class="row removed" role="treeitem" aria-level=${level + 1} style="--level:${level + 1}">
          <span class="gutter"></span><span class="key">${typeof removedKey === "number" ? removedKey : JSON.stringify(removedKey)}</span><span class="punct colon">:</span>
          <span class="before">${preview(removed.before)}</span><span class="meta">Only in published</span>
        </div>`);
      }
      rows.push(html`<div class="row close" aria-hidden="true" style="--level:${level}"><span class="gutter"></span><span class="punct">${end}</span></div>`);
    };

    // The response itself, so the top-level keys sit inside its braces as they do in the JSON.
    const [rootStart, rootEnd] = brackets(this.data);
    rows.push(html`<div class="row root" aria-hidden="true" style="--level:0"><span class="punct">${rootStart}</span></div>`);
    for (const [key, child] of children(this.data)) walk(key, child, [key], 1, this.data, undefined);
    for (const [removedKey, removed] of this.#removedByParent.get(pathKey([])) ?? []) {
      rows.push(html`<div class="row removed" style="--level:1"><span class="gutter"></span><span class="key">${JSON.stringify(removedKey)}</span><span class="punct colon">:</span><span class="before">${preview(removed.before)}</span><span class="meta">Only in published</span></div>`);
    }
    rows.push(html`<div class="row root" aria-hidden="true" style="--level:0"><span class="punct">${rootEnd}</span></div>`);
    if (searching && !this.#hits.length) {
      return html`<p class="empty">Nothing matches “${this.query.trim()}”.</p>`;
    }
    const thumb = this._thumb
      ? html`<img class="thumb" popover="manual" alt="" src=${this._thumb.src} style="top:${this._thumb.top}px;left:${this._thumb.left}px" />`
      : nothing;
    return html`${thumb}<div class=${this.changes?.size ? "tree diff" : "tree"} role="tree" aria-label="Delivery API response" @keydown=${this.#onKeydown}
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
    :host {
      display: block;
      --json-key: #3730a3;
      --json-string: #0f7a55;
      --json-number: #b45309;
      --json-boolean: #9333ea;
      --json-null: var(--uui-color-text-alt);
      --json-guide: var(--uui-color-divider-standalone, #e9e9eb);
      --json-added: color-mix(in srgb, var(--uui-color-positive, #0b8152) 14%, transparent);
      --json-removed: color-mix(in srgb, var(--uui-color-danger, #d42054) 12%, transparent);
      --json-changed: color-mix(in srgb, var(--uui-color-warning, #fbd142) 22%, transparent);
      --json-mark: color-mix(in srgb, var(--uui-color-warning, #fbd142) 60%, transparent);
      --json-mark-current: var(--uui-color-warning, #fbd142);
      --json-current: color-mix(in srgb, var(--uui-color-selected, #3544b1) 9%, transparent);
      font: 12.5px/1.75 var(--uui-font-monospace, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
      color: var(--uui-color-text);
    }
    :host([theme="dark"]) {
      --json-key: #a5b4fc;
      --json-string: #6ee7b7;
      --json-number: #fbbf24;
      --json-boolean: #d8b4fe;
    }
    /* The tab's panel scrolls the tree both ways; rows stretch to the widest one so hover and
       highlights span the whole line. */
    .tree {
      padding: var(--uui-size-space-2, 6px) 0;
      width: max-content;
      min-width: 100%;
      box-sizing: border-box;
    }
    .row {
      position: relative;
      display: flex;
      align-items: baseline;
      white-space: nowrap;
      /* The response's own braces sit in the first chevron column, so the top-level keys line up
         just inside them without an extra step of indent. */
      padding-left: calc(max(var(--level) - 1, 0) * 18px);
      padding-right: var(--uui-size-space-4, 12px);
      /* One guide per open parent, centred under that parent's 18px chevron column. */
      background-image: repeating-linear-gradient(to right, transparent 0 8.5px, var(--json-guide) 8.5px 9.5px, transparent 9.5px 18px);
      background-size: calc((var(--level) - 1) * 18px) 100%;
      background-position: 0 0;
      background-repeat: no-repeat;
      outline: none;
    }
    .row:hover,
    .row:focus-visible {
      background-color: var(--uui-color-surface-emphasis);
    }
    .row:focus-visible {
      box-shadow: inset 0 0 0 2px var(--uui-color-focus);
    }
    .gutter {
      flex: none;
      width: 18px;
      text-align: center;
      color: var(--uui-color-text-alt);
    }
    button.chevron {
      all: unset;
      flex: none;
      width: 18px;
      text-align: center;
      cursor: pointer;
      color: var(--uui-color-text-alt);
    }
    button.chevron:hover {
      color: var(--uui-color-text);
    }
    .key { color: var(--json-key); }
    .root .punct { padding-left: 4px; }
    .index, .punct, .meta { color: var(--uui-color-text-alt); }
    .colon { margin-right: 0.6ch; }
    .meta { margin-left: 6px; font-family: var(--uui-font-family); font-size: 11px; }
    .string { color: var(--json-string); }
    a.link { text-decoration: underline; text-decoration-color: color-mix(in srgb, currentColor 40%, transparent); text-underline-offset: 2px; }
    a.link:hover { text-decoration-color: currentColor; }
    .number { color: var(--json-number); }
    .boolean { color: var(--json-boolean); }
    .null { color: var(--json-null); }
    .tag {
      margin-left: 8px;
      padding: 0 7px;
      border-radius: 99px;
      font: 600 10.5px/1.6 var(--uui-font-family);
      background: color-mix(in srgb, var(--json-key) 10%, transparent);
      color: var(--json-key);
    }
    .actions {
      display: none;
      gap: 4px;
      margin-left: auto;
      padding-left: var(--uui-size-space-5, 18px);
    }
    .row:hover .actions,
    .row:focus-within .actions {
      display: inline-flex;
    }
    .actions button {
      all: unset;
      cursor: pointer;
      padding: 0 6px;
      font: 500 11px/1.6 var(--uui-font-family);
      color: var(--uui-color-text-alt);
      border: 1px solid var(--uui-color-border);
      border-radius: 3px;
      background: var(--uui-color-surface);
    }
    .actions button:hover { color: var(--uui-color-text); border-color: var(--uui-color-border-emphasis); }
    .actions button:focus-visible { outline: 2px solid var(--uui-color-focus); }
    /* With changes, the tree gets a column of its own at the left for − and +, outside the
       indentation, as in a code review. A changed row's tint runs into that column, and the indent
       guides carry on through it a shade darker so they still read on the tint. */
    .tree.diff { padding-left: 16px; }
    .added, .removed, .changed {
      background-color: var(--diff-tint);
      box-shadow: -16px 0 0 var(--diff-tint);
      --json-guide: color-mix(in srgb, var(--diff-ink) 28%, transparent);
    }
    .added:focus-visible, .removed:focus-visible, .changed:focus-visible {
      box-shadow: -16px 0 0 var(--diff-tint), inset 0 0 0 2px var(--uui-color-focus);
    }
    .added { --diff-tint: var(--json-added); --diff-ink: var(--uui-color-positive, #0b8152); }
    .removed { --diff-tint: var(--json-removed); --diff-ink: var(--uui-color-danger, #d42054); }
    .changed { --diff-tint: var(--json-changed); --diff-ink: var(--uui-color-warning-contrast, #8a5a00); }
    .added::before, .removed::before, .changed::before {
      position: absolute;
      left: -12px;
      font-weight: 600;
    }
    .added::before { content: "+"; color: var(--uui-color-positive); }
    .removed::before { content: "−"; color: var(--uui-color-danger); }
    .changed::before { content: "~"; color: var(--uui-color-warning-contrast, #8a5a00); }
    .before { margin-right: 8px; text-decoration: line-through; color: var(--uui-color-danger); }
    .removed .before { text-decoration: none; }
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
