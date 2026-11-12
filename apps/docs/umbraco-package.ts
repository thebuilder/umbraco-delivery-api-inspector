import { defineUmbracoPackage } from "@thebuilder/umbraco-docs";

export const inspectorPackage = defineUmbracoPackage({
  id: "thebuilder.deliveryapiinspector",
  name: "Delivery API Inspector",
  summary:
    "Adds an API tab to every document and media item in the backoffice, with the JSON the Delivery API returns for it.",
  links: {
    docs: "https://delivery-api-inspector.thebuilder.dk",
    nuget: "https://www.nuget.org/packages/TheBuilder.DeliveryApiInspector",
    marketplace: "https://marketplace.umbraco.com/package/thebuilder.deliveryapiinspector",
    github: "https://github.com/thebuilder/umbraco-delivery-api-inspector",
  },
  logo: "/logo-mark.svg",
  compatibility: { umbraco: ">=17.4 <19", dotnet: ">=10" },
  status: "stable",
  categories: ["Headless", "Developer Tools"],
});
