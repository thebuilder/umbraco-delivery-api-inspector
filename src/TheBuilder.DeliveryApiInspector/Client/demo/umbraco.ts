/**
 * Stand-ins for the backoffice modules the API tab imports, so the real element runs on the docs
 * landing page. The demo element provides each context through `provide`; the tab consumes them as
 * it does in Umbraco.
 */
import { css, type LitElement } from "@umbraco-cms/backoffice/external/lit";

export class Token<T = any> {
  declare TYPE: T;
  constructor(readonly name: string) {}
}

export const UMB_ACTION_EVENT_CONTEXT = new Token("action-event");
export const UMB_DOCUMENT_WORKSPACE_CONTEXT = new Token<any>("document-workspace");
export const UMB_MEDIA_WORKSPACE_CONTEXT = new Token<any>("media-workspace");
export const UMB_NOTIFICATION_CONTEXT = new Token<{ peek(color: string, args: { data: { message: string } }): void }>("notification");
export const UMB_PROPERTY_DATASET_CONTEXT = new Token<any>("property-dataset");
export const UMB_THEME_CONTEXT = new Token<any>("theme");

export class UmbRequestReloadStructureForEntityEvent extends Event {
  static TYPE = "request-reload-structure-for-entity";
}
export class UmbRequestReloadChildrenOfEntityEvent extends Event {
  static TYPE = "request-reload-children-of-entity";
}

export const UmbTextStyles = css``;

/** A value that can be watched, like the backoffice's observables. */
export class State<T> {
  #listeners = new Set<(value: T) => void>();
  constructor(private value: T) {}
  get(): T {
    return this.value;
  }
  set(value: T): void {
    this.value = value;
    this.#listeners.forEach((listener) => listener(value));
  }
  subscribe(listener: (value: T) => void): () => void {
    this.#listeners.add(listener);
    listener(this.value);
    return () => this.#listeners.delete(listener);
  }
}

/** Contexts by token, set by the demo before the tab connects. */
export const provided = new Map<Token, unknown>();

type Constructor<T = LitElement> = abstract new (...args: any[]) => T;

export const UmbElementMixin = <Base extends Constructor>(base: Base) => {
  abstract class Element extends base {
    #subscriptions = new Map<string, () => void>();

    consumeContext<T>(token: Token<T>, callback: (context: T | undefined) => void): void {
      if (provided.has(token)) callback(provided.get(token) as T);
    }

    observe<T>(source: State<T> | undefined, callback: (value: T) => void, alias: string): void {
      this.#subscriptions.get(alias)?.();
      if (source) this.#subscriptions.set(alias, source.subscribe(callback));
    }

    disconnectedCallback(): void {
      super.disconnectedCallback();
      this.#subscriptions.forEach((unsubscribe) => unsubscribe());
      this.#subscriptions.clear();
    }
  }
  return Element;
};
