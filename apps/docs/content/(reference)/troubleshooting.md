---
title: Troubleshooting
description: What to check when the API tab is missing or shows an error.
seo:
  image: /og/troubleshooting.png
---

## The API tab is missing

- The user needs a group with the **View Delivery API output** permission, for this document if the group sets permissions on part of the tree, or a group named in `DeliveryApiInspector:UserGroups`. See [Access](/access).
- A new document has no tab until it has been saved once.
- `DeliveryApiInspector:Enabled` may be off for this environment.
- On media items, `DeliveryApiInspector:Media` may be off.
- After changing a setting in appsettings, reload the backoffice. It reads the settings when it loads.

## The tab says the Delivery API is not added

Call `AddDeliveryApi()` on the Umbraco builder in `Program.cs`. The inspector uses the Delivery API's own builders, so it cannot show anything without them.

## The tab says the document does not exist

For Draft, the document has to be saved. For Published, it has to be published in the culture you are editing. A user also needs the Browse permission on the document, inside their start nodes.

## A property is missing or not expanded

The Delivery API leaves out properties whose property editor it cannot output, and returns linked items as references unless `expand` asks for more. Set **Expand** to All, or pick the property, and check that its property editor is supported by the Delivery API.

## The output differs from my frontend's

The inspector shows the API's response for the request above the tree. Compare that request with your frontend's: a different culture, a missing `Preview` header, or a different `expand` changes the output. Copy it as curl and run it against the site to see the public endpoint answer the same request.
