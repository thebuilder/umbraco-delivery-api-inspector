import { UMB_ACTION_EVENT_CONTEXT } from "@umbraco-cms/backoffice/action";
import { UMB_DOCUMENT_WORKSPACE_CONTEXT } from "@umbraco-cms/backoffice/document";
import { UmbElementMixin } from "@umbraco-cms/backoffice/element-api";
import { UmbRequestReloadChildrenOfEntityEvent, UmbRequestReloadStructureForEntityEvent } from "@umbraco-cms/backoffice/entity-action";
import { css, customElement, html, LitElement, nothing, query, state, type PropertyValues } from "@umbraco-cms/backoffice/external/lit";
import { UMB_MEDIA_WORKSPACE_CONTEXT } from "@umbraco-cms/backoffice/media";
import { UMB_NOTIFICATION_CONTEXT } from "@umbraco-cms/backoffice/notification";
import { UMB_PROPERTY_DATASET_CONTEXT } from "@umbraco-cms/backoffice/property";
import { UmbTextStyles } from "@umbraco-cms/backoffice/style";
import { UMB_THEME_CONTEXT } from "@umbraco-cms/backoffice/themes";
import { api, backofficeOrigin, InspectorError, type InspectorConfig, type InspectorResponse } from "./api.js";
import { diff, isContainer, type Change, type Json } from "./json.js";
import type { TreeHits } from "./json-tree.element.js";
import "./json-tree.element.js";
import { buildRequest, fitUrl, fullUrl, propertiesParam, toCurl, toFetch, type DeliveryRequest, type ItemType, type UrlParts } from "./request.js";

type Mode = "draft" | "published" | "changes";
type Expand = "none" | "all" | "pick";

interface Saved {
  mode?: Mode;
  depth?: number;
  view?: "tree" | "raw";
  expand?: Expand;
  changeStyle?: "diff" | "inline";
}

const storageKey = "thebuilder.delivery-api-inspector";

const load = (): Saved => {
  try {
    return JSON.parse(localStorage.getItem(storageKey) ?? "{}") as Saved;
  } catch {
    return {};
  }
};

/**
 * The API tab on documents and media items: what the Delivery API returns for the item, as a tree
 * you can search, with the request a frontend would send for it.
 */
@customElement("thebuilder-delivery-api-inspector-view")
export class InspectorViewElement extends UmbElementMixin(LitElement) {
  @state() private _type: ItemType = "content";
  @state() private _id?: string;
  @state() private _culture?: string;
  @state() private _segment?: string;
  @state() private _published = false;
  @state() private _pending = false;
  @state() private _config?: InspectorConfig;
  @state() private _configError?: string;

  @state() private _mode: Mode = "draft";
  @state() private _expand: Expand = "none";
  @state() private _expandPick: string[] = [];
  @state() private _fieldsPick: string[] = [];
  @state() private _fieldsOpen = false;
  @state() private _view: "tree" | "raw" = "tree";
  @state() private _changeStyle: "diff" | "inline" = "diff";
  @state() private _depth = 3;
  @state() private _query = "";
  @state() private _hits?: TreeHits;

  @state() private _response?: InspectorResponse;
  @state() private _changes?: Map<string, Change>;
  @state() private _aliases: string[] = [];
  @state() private _error?: string;
  @state() private _loading = false;
  @state() private _theme: "light" | "dark" = "light";
  @state() private _url?: UrlParts;
  @state() private _headersOpen = false;

  @query("#url") private _urlElement?: HTMLElement;

  #notification?: typeof UMB_NOTIFICATION_CONTEXT.TYPE;
  #abort?: AbortController;
  #resize = new ResizeObserver(() => this.#fitUrl());
  #reload = () => void this.#fetch();

  constructor() {
    super();
    const saved = load();
    this._mode = saved.mode ?? "draft";
    this._depth = saved.depth ?? 3;
    this._view = saved.view ?? "tree";
    this._changeStyle = saved.changeStyle ?? "diff";
    this._expand = saved.expand === "pick" ? "none" : (saved.expand ?? "none");

    this.consumeContext(UMB_NOTIFICATION_CONTEXT, (context) => (this.#notification = context));
    this.consumeContext(UMB_THEME_CONTEXT, (context) => {
      this.observe(context?.theme, (theme) => (this._theme = theme === "umb-dark-theme" ? "dark" : "light"), "_theme");
    });
    this.consumeContext(UMB_PROPERTY_DATASET_CONTEXT, (context) => {
      const variant = context?.getVariantId();
      this._culture = variant?.culture ?? undefined;
      this._segment = variant?.segment ?? undefined;
    });
    this.consumeContext(UMB_DOCUMENT_WORKSPACE_CONTEXT, (context) => {
      if (!context) return;
      this._type = "content";
      this.observe(context.unique, (unique) => (this._id = unique ?? undefined), "_unique");
      this.observe(context.variants, (variants) => {
        const variant = variants.find((v) => v.culture === (this._culture ?? null) && v.segment === (this._segment ?? null)) ?? variants[0];
        // Compared as strings: Umbraco 17 exports the enum as DocumentVariantStateModel and 18 as
        // PublishableVariantStateModel, with the same values.
        const state = variant?.state as string | null | undefined;
        this._published = state === "Published" || state === "PublishedPendingChanges";
        this._pending = state === "PublishedPendingChanges";
      }, "_variants");
    });
    this.consumeContext(UMB_MEDIA_WORKSPACE_CONTEXT, (context) => {
      if (!context) return;
      this._type = "media";
      this.observe(context.unique, (unique) => (this._id = unique ?? undefined), "_unique");
    });
    // Saving and publishing reload the item's structure; fetch again when they do.
    this.consumeContext(UMB_ACTION_EVENT_CONTEXT, (context) => {
      context?.removeEventListener(UmbRequestReloadStructureForEntityEvent.TYPE, this.#reload);
      context?.removeEventListener(UmbRequestReloadChildrenOfEntityEvent.TYPE, this.#reload);
      context?.addEventListener(UmbRequestReloadStructureForEntityEvent.TYPE, this.#reload);
      context?.addEventListener(UmbRequestReloadChildrenOfEntityEvent.TYPE, this.#reload);
    });
    api.config().then(
      (config) => (this._config = config),
      (error: unknown) => (this._configError = error instanceof Error ? error.message : "Could not read the settings."),
    );
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#abort?.abort();
    this.#resize.disconnect();
  }

  protected willUpdate(changed: PropertyValues): void {
    // Published is not there to show until the item has been published once.
    if (this._type === "content" && !this._published && this._mode !== "draft" && changed.has("_published")) {
      this._mode = "draft";
    }
  }

  protected updated(changed: PropertyValues): void {
    const inputs = ["_id", "_culture", "_segment", "_mode", "_expand", "_expandPick", "_fieldsPick", "_config", "_published", "_type"] as const;
    if (inputs.some((name) => changed.has(name))) {
      void this.#fetch();
    }
    if (this._urlElement) {
      this.#resize.disconnect();
      this.#resize.observe(this._urlElement);
    }
    if (["_mode", "_depth", "_view", "_expand", "_changeStyle"].some((name) => changed.has(name))) {
      try {
        localStorage.setItem(storageKey, JSON.stringify({ mode: this._mode, depth: this._depth, view: this._view, expand: this._expand, changeStyle: this._changeStyle } satisfies Saved));
      } catch {
        // Private windows and blocked storage: the choices just are not remembered.
      }
    }
    if (inputs.some((name) => changed.has(name)) || changed.has("_response")) {
      this.#fitUrl();
    }
  }

  get #expandParam(): string {
    if (this._expand === "all") return "properties[$all]";
    if (this._expand === "pick") return propertiesParam(this._expandPick);
    return "";
  }

  get #fieldsParam(): string {
    return propertiesParam(this._fieldsPick);
  }

  get #request(): DeliveryRequest | undefined {
    if (!this._id || !this._config) return undefined;
    const delivery = this._config.deliveryApi;
    return buildRequest(delivery.path, {
      type: this._type,
      id: this._id,
      preview: this._type === "content" && this._mode === "draft",
      culture: this._culture,
      segment: this._segment,
      expand: this.#expandParam,
      fields: this.#fieldsParam,
      publicAccess: this._type === "media" ? delivery.mediaPublicAccess : delivery.publicAccess,
      hasApiKey: delivery.hasApiKey,
    });
  }

  async #fetch(): Promise<void> {
    const config = this._config;
    if (!this._id || !config?.allowed || !config.deliveryApi.installed) return;
    if (this._type === "media" && !config.media) return;
    this.#abort?.abort();
    const abort = (this.#abort = new AbortController());
    const id = this._id;
    const query = { culture: this._culture, segment: this._segment, expand: this.#expandParam, fields: this.#fieldsParam };
    this._loading = true;
    this._error = undefined;
    try {
      if (this._type === "media") {
        this._response = await api.item("media", id, query, abort.signal);
        this._changes = undefined;
      } else if (this._mode === "changes") {
        const [draft, published] = await Promise.all([
          api.item("content", id, { ...query, preview: true }, abort.signal),
          api.item("content", id, { ...query, preview: false }, abort.signal),
        ]);
        this._response = draft;
        this._changes = diff(published.data, draft.data);
      } else {
        this._response = await api.item("content", id, { ...query, preview: this._mode === "draft" }, abort.signal);
        this._changes = undefined;
      }
      // The aliases the pickers offer: every property this item has, read from the response itself.
      const properties = isContainer(this._response.data) && !Array.isArray(this._response.data) ? this._response.data.properties : undefined;
      if (isContainer(properties) && !Array.isArray(properties) && !this._fieldsPick.length) {
        this._aliases = Object.keys(properties);
      }
    } catch (error) {
      if (abort.signal.aborted) return;
      this._response = undefined;
      this._changes = undefined;
      this._error = error instanceof InspectorError || error instanceof Error ? error.message : "Could not load the response.";
    } finally {
      if (!abort.signal.aborted) this._loading = false;
    }
  }

  #fitUrl(): void {
    const element = this._urlElement;
    const request = this.#request;
    if (!element || !request) {
      this._url = undefined;
      return;
    }
    const probe = element.cloneNode(false) as HTMLElement;
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;width:auto;flex:none";
    element.parentElement!.appendChild(probe);
    const available = element.clientWidth;
    this._url = fitUrl(request, (parts) => {
      probe.textContent = parts.lead + parts.id + parts.query;
      return probe.scrollWidth <= available;
    });
    probe.remove();
  }

  async #copy(text: string, message: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.#notification?.peek("positive", { data: { message } });
    } catch {
      this.#notification?.peek("warning", { data: { message: "The browser blocked copying." } });
    }
  }

  #segmented<T extends string | number>(label: string, value: T, options: [T, string, string?][], set: (value: T) => void, disabled: (value: T) => boolean = () => false) {
    return html`<div class="segmented" role="group" aria-label=${label}>
      <span class="label" aria-hidden="true">${label}</span>
      ${options.map(([option, text, title]) => html`<button type="button" aria-pressed=${String(option === value)} title=${title ?? text}
        ?disabled=${disabled(option)} @click=${() => set(option)}>${text}</button>`)}
    </div>`;
  }

  #picker(title: string, chosen: string[], set: (aliases: string[]) => void, hint: string) {
    return html`<div class="picker">
      <div class="picker-head"><strong>${title}</strong><span>${hint}</span>
        ${chosen.length ? html`<button type="button" class="link" @click=${() => set([])}>Clear</button>` : nothing}</div>
      <div class="aliases">
        ${this._aliases.length
          ? this._aliases.map((alias) => html`<label><input type="checkbox" .checked=${chosen.includes(alias)}
              @change=${(event: Event) => set((event.target as HTMLInputElement).checked ? [...chosen, alias] : chosen.filter((a) => a !== alias))} /> ${alias}</label>`)
          : html`<span class="muted">This item has no properties.</span>`}
      </div>
    </div>`;
  }

  render() {
    if (this._configError) return html`<uui-box><p class="state">${this._configError}</p></uui-box>`;
    const config = this._config;
    if (!config) return html`<div class="state"><uui-loader></uui-loader></div>`;
    if (!config.allowed) return html`<uui-box><p class="state">Your user group cannot use the API tab. Ask an administrator to add it under DeliveryApiInspector:UserGroups.</p></uui-box>`;
    if (!config.deliveryApi.installed) return html`<uui-box><p class="state">This site does not add the Delivery API. Call <code>AddDeliveryApi()</code> in Program.cs to use the API tab.</p></uui-box>`;

    const request = this.#request;
    const isContent = this._type === "content";
    const draftDiffers = this._pending;
    const offNote = !config.deliveryApi.enabled
      ? "The Delivery API is turned off on this site (DeliveryApi:Enabled), so frontends get nothing. This is what it would return."
      : this._type === "media" && !config.deliveryApi.mediaEnabled
        ? "The Media Delivery API is turned off (DeliveryApi:Media:Enabled). This is what it would return."
        : undefined;

    return html`
      <div class="toolbar">
        ${isContent
          ? html`<div class="segmented" role="group" aria-label="Version">
              <button type="button" aria-pressed=${String(this._mode === "draft")} @click=${() => (this._mode = "draft")}
                title=${draftDiffers ? "The draft has changes that are not published" : "The latest saved version, as Preview: true returns it"}>
                ${draftDiffers ? html`<span class="dot" aria-hidden="true"></span>` : nothing}Draft</button>
              <button type="button" aria-pressed=${String(this._mode === "published")} ?disabled=${!this._published}
                title=${this._published ? "What frontends get today" : "Not published yet"} @click=${() => (this._mode = "published")}>Published</button>
              <button type="button" aria-pressed=${String(this._mode === "changes")} ?disabled=${!this._published}
                title="What publishing the draft would change" @click=${() => (this._mode = "changes")}>Changes
                ${this._mode === "changes" && this._changes ? html`<span class="count">${this._changes.size}</span>` : nothing}</button>
            </div>`
          : nothing}
        ${isContent && this._mode === "changes" && this._view === "tree"
          ? this.#segmented("Changes as", this._changeStyle, [["diff", "Diff", "A red line for published and a green line for the draft"], ["inline", "Inline", "Published struck through, next to the draft"]], (value) => (this._changeStyle = value))
          : nothing}
        ${this.#segmented<Expand>("expand", this._expand, [["none", "None", "No expand parameter"], ["all", "All", "expand=properties[$all]"], ["pick", "Pick…", "Choose the properties to expand"]], (value) => (this._expand = value))}
        <div class="segmented" role="group" aria-label="fields">
          <span class="label" aria-hidden="true">fields</span>
          <button type="button" aria-pressed=${String(!this._fieldsPick.length && !this._fieldsOpen)} title="Every property" @click=${() => { this._fieldsPick = []; this._fieldsOpen = false; }}>All</button>
          <button type="button" aria-pressed=${String(this._fieldsOpen || !!this._fieldsPick.length)} title="Choose the properties to return" @click=${() => (this._fieldsOpen = !this._fieldsOpen)}>Pick…</button>
        </div>
        ${this.#segmented("View", this._view, [["tree", "Tree"], ["raw", "Raw", "Read-only JSON in the code editor"]], (value) => (this._view = value))}
      </div>
      ${this._expand === "pick" ? this.#picker("Expand", this._expandPick, (aliases) => (this._expandPick = aliases), "Pickers and blocks whose items come back with their properties.") : nothing}
      ${this._fieldsOpen || this._fieldsPick.length ? this.#picker("Fields", this._fieldsPick, (aliases) => (this._fieldsPick = aliases), "Only these properties come back. None chosen means all.") : nothing}
      ${this._view === "tree"
        ? html`<div class="toolbar">
            <uui-input class="search" label="Search keys and values" placeholder="Search keys and values, or type a path like properties.image[0].url"
              .value=${this._query} @input=${(event: InputEvent) => (this._query = (event.target as HTMLInputElement).value)}
              @keydown=${(event: KeyboardEvent) => { if (event.key === "Enter") { event.preventDefault(); this.shadowRoot?.querySelector("thebuilder-json-tree")?.next(event.shiftKey ? -1 : 1); } }}>
              <uui-icon name="icon-search" slot="prepend"></uui-icon>
              <span slot="append" class="hits">${this.#hitsLabel()}</span>
            </uui-input>
            ${this.#segmented("Open levels", this._depth, [[1, "1", "Show the tree one level deep"], [2, "2", "Two levels deep"], [3, "3", "Three levels deep"], [99, "All", "Open every level"]], (value) => { this._depth = value; this.shadowRoot?.querySelector("thebuilder-json-tree")?.reset(); })}
          </div>`
        : nothing}
      <section class="panel" aria-label="Response">
        <div class="panel-header">
        ${request
          ? html`<div class="request">
              <div class="line">
                <span class="method">GET</span>
                <span id="url" class="url" title=${fullUrl(request)}>${this._url
                  ? html`<span class="muted">${this._url.lead}</span>${this._url.id}<span class="query">${this._url.query}</span>`
                  : fullUrl(request)}</span>
                ${request.headers.length
                  ? html`<button type="button" class="headers-toggle" aria-expanded=${String(this._headersOpen)} aria-controls="headers"
                      title=${request.headers.map(([name, value]) => `${name}: ${value}`).join("\n")}
                      @click=${() => (this._headersOpen = !this._headersOpen)}>${request.headers.length} ${request.headers.length === 1 ? "header" : "headers"}<span aria-hidden="true">${this._headersOpen ? "▴" : "▾"}</span></button>`
                  : nothing}
                ${this._response ? html`<span class="stats">${formatBytes(this._response.bytes)}${this._response.buildMs !== undefined ? ` · ${Math.round(this._response.buildMs)} ms` : ""}</span>` : nothing}
              </div>
              ${request.headers.length && this._headersOpen
                ? html`<div class="headers" id="headers">${request.headers.map(([name, value]) => html`<span><span class="muted">${name}:</span> ${value}</span>`)}</div>`
                : nothing}
            </div>`
          : nothing}
        <div class="copy">
          ${request
            ? html`<button type="button" class="copy-button" @click=${() => this.#copy(toCurl(backofficeOrigin(), request), "Copied the curl command.")}><uui-icon name="icon-documents"></uui-icon>Copy as curl</button>
                <button type="button" class="copy-button" @click=${() => this.#copy(toFetch(backofficeOrigin(), request), "Copied the fetch call.")}><uui-icon name="icon-documents"></uui-icon>Copy as fetch</button>`
            : nothing}
        </div>
        </div>
        ${offNote ? html`<p class="note">${offNote}</p>` : nothing}
        <div class="body">${this.#body()}</div>
      </section>
    `;
  }

  #hitsLabel() {
    if (!this._query.trim() || !this._hits) return nothing;
    if (this._hits.path) return "Path";
    return this._hits.count ? `${this._hits.index + 1} of ${this._hits.count}` : "No matches";
  }

  #body() {
    if (this._error) return html`<p class="state">${this._error}</p>`;
    if (!this._response) return html`<div class="state"><uui-loader></uui-loader></div>`;
    if (this._mode === "changes" && this._changes?.size === 0) {
      return html`<p class="state">Draft and published return the same response.</p>`;
    }
    const data: Json = this._response.data;
    if (this._view === "raw") {
      void import("@umbraco-cms/backoffice/code-editor");
      return html`<umb-code-editor class="raw" language="json" readonly .code=${JSON.stringify(data, null, 2)}></umb-code-editor>`;
    }
    return html`<thebuilder-json-tree class=${this._loading ? "loading" : ""} theme=${this._theme} .data=${data} .changes=${this._mode === "changes" ? this._changes : undefined}
      .depth=${this._depth} .query=${this._query} changeStyle=${this._changeStyle}
      @hits=${(event: CustomEvent<TreeHits>) => (this._hits = event.detail)}
      @copied=${(event: CustomEvent<string>) => this.#notification?.peek("positive", { data: { message: event.detail } })}></thebuilder-json-tree>`;
  }

  static styles = [
    UmbTextStyles,
    css`
      /* The tab fills the workspace, and only the response scrolls, so the controls and the request
         stay in view. Below 360px of response it falls back to scrolling the page. */
      :host {
        display: flex;
        flex-direction: column;
        gap: var(--uui-size-space-4);
        height: 100%;
        box-sizing: border-box;
        padding: var(--uui-size-layout-1);
        --inspector-line: color-mix(in srgb, var(--uui-color-border) 75%, transparent);
        --inspector-track: color-mix(in srgb, var(--uui-color-border) 30%, var(--uui-color-surface));
        --inspector-code: color-mix(in srgb, var(--uui-color-background) 45%, var(--uui-color-surface));
      }
      .panel {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 360px;
        min-width: 0;
        overflow: hidden;
        border-radius: 10px;
        background: var(--inspector-code);
        box-shadow: 0 0 0 1px var(--inspector-line), 0 1px 2px rgb(0 0 0 / 0.04), 0 8px 24px -12px rgb(0 0 0 / 0.18);
      }
      .panel-header {
        display: flex;
        align-items: center;
        gap: var(--uui-size-space-4);
        min-height: 36px;
        padding: var(--uui-size-space-3) var(--uui-size-space-3) var(--uui-size-space-3) var(--uui-size-space-5);
        background: var(--uui-color-surface);
        border-bottom: 1px solid var(--inspector-line);
      }
      .body {
        position: relative;
        flex: 1;
        min-height: 0;
        overflow: auto;
      }
      .toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: var(--uui-size-space-3);
        align-items: center;
      }
      /* A track with the chosen option raised out of it, so the current choice reads at a glance. */
      .segmented {
        display: inline-flex;
        align-items: stretch;
        gap: 2px;
        padding: 3px;
        border-radius: 8px;
        background: var(--inspector-track);
        box-shadow: inset 0 0 0 1px var(--inspector-line);
      }
      .segmented .label {
        display: inline-flex;
        align-items: center;
        padding: 0 8px 0 6px;
        font: 12px var(--uui-font-monospace, monospace);
        color: var(--uui-color-text-alt);
      }
      .segmented[aria-label="Open levels"] .label {
        font-family: var(--uui-font-family);
      }
      .segmented[aria-label="Version"] .label,
      .segmented[aria-label="View"] .label,
      .segmented[aria-label="Changes as"] .label {
        display: none;
      }
      .segmented button {
        all: unset;
        cursor: pointer;
        display: inline-flex;
        gap: 6px;
        align-items: center;
        padding: 4px 10px;
        border-radius: 6px;
        font-size: 13px;
        color: var(--uui-color-text-alt);
        transition: background-color 120ms, color 120ms, box-shadow 120ms;
      }
      .segmented button[aria-pressed="true"] {
        background: var(--uui-color-surface);
        color: var(--uui-color-text);
        font-weight: 600;
        box-shadow: 0 1px 2px rgb(0 0 0 / 0.12), 0 0 0 1px var(--inspector-line);
      }
      .segmented button:hover:not([disabled]):not([aria-pressed="true"]) {
        color: var(--uui-color-text);
        background: color-mix(in srgb, var(--uui-color-surface) 55%, transparent);
      }
      .segmented button[disabled] {
        cursor: default;
        opacity: 0.45;
      }
      .segmented button:focus-visible {
        outline: 2px solid var(--uui-color-focus);
        outline-offset: 0;
      }
      .dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--uui-color-warning-standalone, #e0a100);
      }
      .count {
        padding: 0 6px;
        border-radius: 99px;
        font-size: 11px;
        background: var(--uui-color-warning, #fbd142);
        color: var(--uui-color-warning-contrast, #000);
      }
      .search {
        flex: 1;
        min-width: 240px;
      }
      .search uui-icon {
        padding-left: var(--uui-size-space-3);
        color: var(--uui-color-text-alt);
      }
      .hits {
        padding: 0 var(--uui-size-space-3);
        font-size: 12px;
        color: var(--uui-color-text-alt);
        white-space: nowrap;
      }
      .picker {
        display: grid;
        gap: var(--uui-size-space-2);
        padding: var(--uui-size-space-3) var(--uui-size-space-4);
        border: 1px solid var(--uui-color-border);
        border-radius: var(--uui-border-radius);
        background: var(--uui-color-surface);
      }
      .picker-head {
        display: flex;
        gap: var(--uui-size-space-3);
        align-items: baseline;
        font-size: 13px;
      }
      .picker-head span {
        color: var(--uui-color-text-alt);
      }
      .aliases {
        display: flex;
        flex-wrap: wrap;
        gap: var(--uui-size-space-2) var(--uui-size-space-5);
        font: 12.5px var(--uui-font-monospace, monospace);
      }
      .aliases label {
        display: inline-flex;
        gap: 6px;
        align-items: center;
        cursor: pointer;
      }
      button.link {
        all: unset;
        cursor: pointer;
        margin-left: auto;
        color: var(--uui-color-interactive);
        font-size: 12px;
      }
      .request {
        display: grid;
        gap: 6px;
        min-width: 0;
        flex: 1;
        font: 12.5px/1.5 var(--uui-font-monospace, monospace);
      }
      .line {
        display: flex;
        gap: var(--uui-size-space-3);
        align-items: center;
        min-width: 0;
      }
      .method {
        padding: 1px 7px;
        border-radius: 5px;
        font-weight: 700;
        font-size: 11.5px;
        letter-spacing: 0.02em;
        color: var(--uui-color-positive);
        background: color-mix(in srgb, var(--uui-color-positive) 12%, transparent);
      }
      .url {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        color: var(--uui-color-text);
      }
      .muted {
        color: var(--uui-color-text-alt);
      }
      .stats {
        white-space: nowrap;
        color: var(--uui-color-text-alt);
        font-family: var(--uui-font-family);
        font-size: 12px;
      }
      .headers-toggle {
        all: unset;
        cursor: pointer;
        display: inline-flex;
        gap: 4px;
        align-items: center;
        white-space: nowrap;
        padding: 1px 8px;
        border-radius: 99px;
        font: 12px var(--uui-font-family);
        color: var(--uui-color-text-alt);
        box-shadow: inset 0 0 0 1px var(--inspector-line);
      }
      .headers-toggle:hover,
      .headers-toggle[aria-expanded="true"] {
        color: var(--uui-color-text);
        background: var(--inspector-track);
      }
      .headers-toggle:focus-visible {
        outline: 2px solid var(--uui-color-focus);
      }
      .headers {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .headers > span {
        padding: 0 7px;
        border-radius: 5px;
        font-size: 11.5px;
        background: var(--inspector-track);
      }
      .copy {
        display: flex;
        gap: var(--uui-size-space-2);
      }
      .copy-button {
        all: unset;
        cursor: pointer;
        display: inline-flex;
        gap: 6px;
        align-items: center;
        white-space: nowrap;
        padding: 5px 10px;
        border-radius: 7px;
        font: 500 12.5px var(--uui-font-family);
        color: var(--uui-color-text);
        background: var(--uui-color-surface);
        box-shadow: 0 0 0 1px var(--inspector-line), 0 1px 2px rgb(0 0 0 / 0.06);
        transition: background-color 120ms, box-shadow 120ms;
      }
      .copy-button uui-icon {
        font-size: 13px;
        color: var(--uui-color-text-alt);
      }
      .copy-button:hover {
        background: var(--inspector-track);
      }
      .copy-button:focus-visible {
        outline: 2px solid var(--uui-color-focus);
      }
      uui-box {
        --uui-box-default-padding: 0;
      }
      .note {
        margin: 0;
        padding: var(--uui-size-space-3) var(--uui-size-space-5);
        background: var(--uui-color-surface-alt);
        color: var(--uui-color-text-alt);
        font-size: 13px;
      }
      thebuilder-json-tree {
        padding: var(--uui-size-space-2) var(--uui-size-space-3);
      }
      thebuilder-json-tree.loading {
        opacity: 0.55;
        transition: opacity 120ms;
      }
      .raw {
        display: block;
        height: 100%;
      }
      .state {
        display: flex;
        justify-content: center;
        margin: 0;
        padding: var(--uui-size-layout-2) var(--uui-size-space-5);
        color: var(--uui-color-text-alt);
      }
    `,
  ];
}

const formatBytes = (bytes: number): string => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`);

export default InspectorViewElement;

declare global {
  interface HTMLElementTagNameMap {
    "thebuilder-delivery-api-inspector-view": InspectorViewElement;
  }
}
