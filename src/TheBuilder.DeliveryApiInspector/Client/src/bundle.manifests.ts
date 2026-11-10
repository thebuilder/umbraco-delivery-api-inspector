import { UMB_DOCUMENT_WORKSPACE_ALIAS } from "@umbraco-cms/backoffice/document";
import { UMB_MEDIA_WORKSPACE_ALIAS } from "@umbraco-cms/backoffice/media";
import { UMB_WORKSPACE_CONDITION_ALIAS, UMB_WORKSPACE_ENTITY_IS_NEW_CONDITION_ALIAS } from "@umbraco-cms/backoffice/workspace";
import { ACCESS_CONDITION_ALIAS } from "./constants.js";

export const manifests = [
  {
    type: "backofficeEntryPoint",
    alias: "TheBuilder.DeliveryApiInspector.EntryPoint",
    name: "Delivery API Inspector Entry Point",
    js: () => import("./entrypoint.js"),
  },
  {
    type: "condition",
    alias: ACCESS_CONDITION_ALIAS,
    name: "Delivery API Inspector Access Condition",
    api: () => import("./access.condition.js"),
  },
  // The API tab, after Content and before Info.
  ...[
    { workspace: UMB_DOCUMENT_WORKSPACE_ALIAS, name: "Document", media: false },
    { workspace: UMB_MEDIA_WORKSPACE_ALIAS, name: "Media", media: true },
  ].map(({ workspace, name, media }) => ({
    type: "workspaceView",
    alias: `TheBuilder.DeliveryApiInspector.WorkspaceView.${name}`,
    name: `Delivery API Inspector ${name} View`,
    element: () => import("./inspector-view.element.js"),
    weight: 150,
    meta: { label: "API", pathname: "api", icon: "icon-code" },
    conditions: [
      { alias: UMB_WORKSPACE_CONDITION_ALIAS, match: workspace },
      { alias: UMB_WORKSPACE_ENTITY_IS_NEW_CONDITION_ALIAS, match: false },
      { alias: ACCESS_CONDITION_ALIAS, media },
    ],
  })),
] as UmbExtensionManifest[];
