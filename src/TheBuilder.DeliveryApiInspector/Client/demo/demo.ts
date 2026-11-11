/**
 * The interactive demo on the docs landing page: the real API tab element, fed with responses
 * captured from the sample site, inside a small frame that stands in for the backoffice workspace.
 */
import { css, customElement, html, LitElement, state } from "@umbraco-cms/backoffice/external/lit";
import fixtures from "./fixtures.json";
import {
  provided,
  State,
  UMB_DOCUMENT_WORKSPACE_CONTEXT,
  UMB_NOTIFICATION_CONTEXT,
  UMB_PROPERTY_DATASET_CONTEXT,
  UMB_THEME_CONTEXT,
} from "./umbraco.js";
import "../src/inspector-view.element.js";

const icons: Record<string, string> = {
  "icon-documents": '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  "icon-search": '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  "icon-document": '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  "icon-code": '<path d="m9 8-5 4 5 4M15 8l5 4-5 4"/>',
  "icon-info": '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
};

/** The few UUI elements the tab uses, drawn without the UI library. */
@customElement("uui-icon")
export class DemoIcon extends LitElement {
  static properties = { name: { type: String } };
  declare name: string;
  render() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.innerHTML = icons[this.name] ?? "";
    return svg;
  }
  static styles = css`
    :host { display: inline-flex; width: 1em; height: 1em; vertical-align: middle; }
    svg { width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  `;
}

@customElement("uui-loader")
export class DemoLoader extends LitElement {
  render() {
    return html`<span></span><span></span><span></span>`;
  }
  static styles = css`
    :host { display: inline-flex; gap: 4px; }
    span { width: 6px; height: 6px; border-radius: 50%; background: var(--uui-color-text-alt); animation: pulse 0.9s infinite ease-in-out; }
    span:nth-child(2) { animation-delay: 0.15s; }
    span:nth-child(3) { animation-delay: 0.3s; }
    @keyframes pulse { 50% { opacity: 0.25; } }
  `;
}

@customElement("uui-box")
export class DemoBox extends LitElement {
  render() {
    return html`<slot></slot>`;
  }
  static styles = css`:host { display: block; padding: 18px; border-radius: 6px; background: var(--uui-color-surface); }`;
}

const docsTheme = () => (document.documentElement.dataset.theme === "dark" ? "umb-dark-theme" : "umb-light-theme");

@customElement("delivery-api-inspector-demo")
export class DeliveryApiInspectorDemo extends LitElement {
  @state() private _toast?: { message: string; key: number };
  @state() private _dark = docsTheme() === "umb-dark-theme";
  #theme = new State(docsTheme());
  #observer = new MutationObserver(() => {
    this.#theme.set(docsTheme());
    this._dark = this.#theme.get() === "umb-dark-theme";
  });
  #timer?: number;

  connectedCallback(): void {
    super.connectedCallback();
    this.#observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    provided.set(UMB_THEME_CONTEXT, { theme: this.#theme });
    provided.set(UMB_PROPERTY_DATASET_CONTEXT, { getVariantId: () => ({ culture: null, segment: null }) });
    // Harbour mornings is published, with a saved draft that changes its summary.
    provided.set(UMB_DOCUMENT_WORKSPACE_CONTEXT, {
      unique: new State(fixtures.id),
      variants: new State([{ culture: null, segment: null, state: "PublishedPendingChanges" }]),
    });
    provided.set(UMB_NOTIFICATION_CONTEXT, {
      peek: (_color: string, { data }: { data: { message: string } }) => {
        this._toast = { message: data.message, key: Date.now() };
        clearTimeout(this.#timer);
        this.#timer = window.setTimeout(() => (this._toast = undefined), 2200);
      },
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#observer.disconnect();
  }

  render() {
    return html`
      <div class="frame ${this._dark ? "dark" : "light"}">
        <header>
          <span class="name">Harbour mornings</span>
          <nav aria-label="Workspace views (demo)">
            <span class="tab" aria-disabled="true"><uui-icon name="icon-document"></uui-icon>Content</span>
            <span class="tab active" aria-current="page"><uui-icon name="icon-code"></uui-icon>API</span>
            <span class="tab" aria-disabled="true"><uui-icon name="icon-info"></uui-icon>Info</span>
          </nav>
        </header>
        <div class="body">
          <thebuilder-delivery-api-inspector-view></thebuilder-delivery-api-inspector-view>
        </div>
        ${this._toast ? html`<div class="toast" role="status">${this._toast.message}</div>` : ""}
      </div>
    `;
  }

  static styles = css`
    :host { display: block; }
    .frame {
      position: relative;
      display: flex;
      flex-direction: column;
      height: var(--demo-height, 600px);
      overflow: hidden;
      border-radius: 12px;
      background: var(--uui-color-background);
      color: var(--uui-color-text);
      font-family: var(--uui-font-family);
      --uui-font-family: Lato, "Helvetica Neue", Helvetica, Arial, sans-serif;
      --uui-font-monospace: ui-monospace, Menlo, Monaco, "Cascadia Mono", "Courier New", monospace;
      --uui-size-layout-1: 20px;
      --uui-size-layout-2: 30px;
      --uui-size-space-2: 6px;
      --uui-size-space-3: 9px;
      --uui-size-space-4: 12px;
      --uui-size-space-5: 18px;
      --uui-border-radius: 3px;
      --uui-shadow-depth-3: #0000001a 0 6px 16px 0, #0000001a 0 0 2px 0;
    }
    .light {
      --uui-color-background: #f7f7f8; --uui-color-border: #d8d7d9; --uui-color-border-emphasis: #a1a1a1; --uui-color-border-standalone: #c2c2c2;
      --uui-color-danger: #df2a5d; --uui-color-focus: #3879ff; --uui-color-interactive: #1b264f; --uui-color-interactive-emphasis: #2d42ab;
      --uui-color-positive: #0b8152; --uui-color-selected: #283a97; --uui-color-selected-contrast: #fff; --uui-color-surface: #fff;
      --uui-color-surface-alt: #f7f7f8; --uui-color-surface-emphasis: #fafafa; --uui-color-text: #060606; --uui-color-text-alt: #2e2b29;
      --uui-color-warning: #fad634; --uui-color-warning-contrast: #000; --uui-color-warning-standalone: #a17700; --uui-color-header-surface: #1b264f;
    }
    .dark {
      --uui-color-background: #21262e; --uui-color-border: #434c56; --uui-color-border-emphasis: #626e7b; --uui-color-border-standalone: #545d68;
      --uui-color-danger: #ca3b37; --uui-color-focus: #316dca; --uui-color-interactive: #eeeeef; --uui-color-interactive-emphasis: #eeeeef;
      --uui-color-positive: #347d39; --uui-color-selected: #316dca; --uui-color-selected-contrast: #eeeeef; --uui-color-surface: #2d333b;
      --uui-color-surface-alt: #373e47; --uui-color-surface-emphasis: #333a42; --uui-color-text: #eeeeef; --uui-color-text-alt: #eeeeef;
      --uui-color-warning: #af7c12; --uui-color-warning-contrast: #eeeeef; --uui-color-warning-standalone: #af7c12; --uui-color-header-surface: #21262e;
    }
    header {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 16px;
      padding: 0 20px;
      min-height: 56px;
      background: var(--uui-color-surface);
      border-bottom: 1px solid var(--uui-color-border);
    }
    .name { align-self: center; font-weight: 700; font-size: 15px; }
    nav { display: flex; align-self: stretch; }
    .tab { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; min-width: 64px; padding: 0 10px; font-size: 12px; color: var(--uui-color-interactive); border-left: 1px solid var(--uui-color-border); box-shadow: inset 0 -4px 0 transparent; }
    .tab uui-icon { font-size: 17px; }
    .tab[aria-disabled] { opacity: 0.55; }
    .tab.active { box-shadow: inset 0 -4px 0 var(--uui-color-current, #f5c1bc); }
    .body { flex: 1; overflow: auto; overscroll-behavior: contain; }
    .toast {
      position: absolute;
      left: 50%;
      bottom: 18px;
      transform: translateX(-50%);
      padding: 9px 16px;
      border-radius: 6px;
      background: var(--uui-color-positive);
      color: #fff;
      font-size: 13px;
      box-shadow: var(--uui-shadow-depth-3);
      white-space: nowrap;
    }
    @media (max-width: 640px) {
      header { padding: 0 12px; }
      .name { display: none; }
      nav { margin-left: auto; }
    }
  `;
}
