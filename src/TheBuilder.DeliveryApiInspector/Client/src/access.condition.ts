import { UMB_ENTITY_CONTEXT } from "@umbraco-cms/backoffice/entity";
import { UmbConditionBase } from "@umbraco-cms/backoffice/extension-registry";
import type { UmbConditionConfigBase, UmbConditionControllerArguments, UmbExtensionCondition } from "@umbraco-cms/backoffice/extension-api";
import type { UmbControllerHost } from "@umbraco-cms/backoffice/controller-api";
import { api } from "./api.js";

import { ACCESS_CONDITION_ALIAS } from "./constants.js";

export interface AccessConditionConfig extends UmbConditionConfigBase<typeof ACCESS_CONDITION_ALIAS> {
  /** Media items have a setting of their own. */
  media?: boolean;
}

/**
 * Shows the API tab to users whose groups have the View Delivery API output permission, or are named
 * in DeliveryApiInspector:UserGroups. A document asks the server, which applies the permission the
 * way Umbraco does: the closest permission set on the document's path, or else the group's default.
 */
export class AccessCondition extends UmbConditionBase<AccessConditionConfig> implements UmbExtensionCondition {
  #unique?: string;

  constructor(host: UmbControllerHost, args: UmbConditionControllerArguments<AccessConditionConfig>) {
    super(host, args);
    api.config().then(
      (config) => {
        if (args.config.media) {
          this.permitted = config.media;
          return;
        }
        if (!config.allowed) {
          this.permitted = false;
          return;
        }
        this.consumeContext(UMB_ENTITY_CONTEXT, (context) => {
          this.observe(context?.unique, (unique) => {
            // A quick switch between documents can answer out of order, so only the latest document counts.
            this.#unique = unique ?? undefined;
            if (!unique) {
              this.permitted = false;
              return;
            }
            api.contentAccess(unique).then(
              (allowed) => {
                if (this.#unique === unique) this.permitted = allowed;
              },
              () => {
                if (this.#unique === unique) this.permitted = false;
              },
            );
          }, "_unique");
        });
      },
      () => (this.permitted = false),
    );
  }
}

export default AccessCondition;
