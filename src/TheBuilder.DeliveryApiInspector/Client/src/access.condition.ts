import { UmbConditionBase } from "@umbraco-cms/backoffice/extension-registry";
import type { UmbConditionConfigBase, UmbConditionControllerArguments, UmbExtensionCondition } from "@umbraco-cms/backoffice/extension-api";
import type { UmbControllerHost } from "@umbraco-cms/backoffice/controller-api";
import { api } from "./api.js";

import { ACCESS_CONDITION_ALIAS } from "./constants.js";

export interface AccessConditionConfig extends UmbConditionConfigBase<typeof ACCESS_CONDITION_ALIAS> {
  /** Media items have a setting of their own. */
  media?: boolean;
}

/** Shows the API tab to the user groups DeliveryApiInspector:UserGroups names, administrators by default. */
export class AccessCondition extends UmbConditionBase<AccessConditionConfig> implements UmbExtensionCondition {
  constructor(host: UmbControllerHost, args: UmbConditionControllerArguments<AccessConditionConfig>) {
    super(host, args);
    api.config().then(
      (config) => (this.permitted = args.config.media ? config.media : config.allowed),
      () => (this.permitted = false),
    );
  }
}

export default AccessCondition;
