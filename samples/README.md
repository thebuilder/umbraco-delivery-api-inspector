# Samples

`TheBuilder.DeliveryApiInspector.Example` is an Umbraco 17 site (SQLite) that installs itself and
seeds content with nested sections, blocks, pickers, media folders and culture-variant pages on its
first start. It references the package project, so the API tab is on every document and media item.

## Run it

Needs the .NET 10 SDK, and pnpm for the backoffice client.

```bash
pnpm install && pnpm build
dotnet run --project samples/TheBuilder.DeliveryApiInspector.Example
```

The backoffice is http://localhost:5330/umbraco, user `local@example.invalid`, password
`LocalOnly!42` (local only). Every start adds any seeded item that is missing, checked by key. The
Delivery API key is `example-local-preview-key`.

The seed leaves one unpublished change on Harbour mornings (`e0000000-0000-0000-0000-000000000003`),
so its Changes view has something to show.

Every start also makes sure there is an API user for scripts (`Seeding/ExampleApiUserSeeder.cs`), in
the Administrators group, with client id `umbraco-back-office-api-inspector-e2e` and secret
`example-local-e2e-client-secret` (local only).

`pnpm watch` in `src/TheBuilder.DeliveryApiInspector/Client` rebuilds the tab as you edit it; reload
the backoffice to pick it up.

## Check it automatically

With the sample running:

```bash
pnpm e2e
```

It lists every document and media item through the Management API, asks the inspector for each one
(every culture, draft and published, with four `expand` and `fields` variants) and compares the
answer with the public Delivery API's for the same request. It also checks that the inspector's API
refuses a request without a sign-in and returns the API's own error for a malformed `expand`. Set
`SITE_URL` for a sample on another address.

To run the sample on Umbraco 18:

```bash
dotnet run --project samples/TheBuilder.DeliveryApiInspector.Example -p:SampleUmbracoVersion=18.3.1
```
