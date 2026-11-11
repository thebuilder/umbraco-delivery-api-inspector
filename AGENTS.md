# Agents

`TheBuilder.DeliveryApiInspector` is one NuGet package for Umbraco 17 and 18 (.NET 10): an API tab on
every document and media item in the backoffice that shows exactly what the Delivery API returns for
it.

- The tab shows the Delivery API's own output. The server builds it with Umbraco's
  `IApiContentResponseBuilder` and `IApiMediaWithCropsResponseBuilder`, never a copy of their logic,
  and `tests/e2e` compares it with the public endpoint.
- No Swagger and no API client. Umbraco 18 documents the Delivery API itself.
- No JSON viewer library: the tree is our own Lit element on UUI tokens.
- No Claude co-author trailers in commits, and no "Generated with Claude Code" lines in pull requests.

## Layout

- `src/TheBuilder.DeliveryApiInspector`: the package. `ManagementApi/InspectorController.cs` builds
  the responses behind the backoffice's sign-in, `ManagementApi/InspectorAccess.cs` decides who may
  use the tab, `Configuration/` holds the settings.
- `src/TheBuilder.DeliveryApiInspector/Client`: the backoffice tab (Lit, built with Vite).
  `json.ts` (paths, search, diff) and `request.ts` (the request bar, URL fitting, curl and fetch)
  are pure and unit tested in `test/`. `json-tree.element.ts` is the tree,
  `inspector-view.element.ts` the tab around it.
- `samples/TheBuilder.DeliveryApiInspector.Example`: an Umbraco site with seeded content, on
  http://localhost:5330.
- `tests/e2e`: compares the tab's output with the real Delivery API for every seeded item.
- `apps/docs`: the documentation site.

## Commands

```bash
dotnet build TheBuilder.DeliveryApiInspector.slnx
pnpm install && pnpm typecheck && pnpm test && pnpm build
dotnet run --project samples/TheBuilder.DeliveryApiInspector.Example
pnpm e2e                # against the running sample
pnpm docs:screenshots   # retakes the docs screenshots from the running sample
pnpm docs:demo          # recaptures the landing page demo's responses from the running sample
```

## Traps

- The Delivery API reads `expand` and `fields` in the syntax of the requested API version, and
  backoffice routes are version 1. The controller sets the requested version to 2.0 through
  `IApiVersioningFeature` (the `HttpContext.ApiVersioningFeature()` extension is gone in
  Asp.Versioning 10, which Umbraco 18 ships).
- The Delivery API reads `Accept-Language`, `Accept-Segment` and `Preview` from the request. The
  controller replaces the backoffice's own headers before building.
- Media URLs in the backoffice need HMAC-signed resize URLs; the thumbnail asks the Management API's
  `imaging/resize/urls` for one.
- Some backoffice types (such as `DocumentVariantStateModel`) are not exported on both majors.
  Compare against strings, and build the client against `@umbraco-cms/backoffice` 17.

## Public C# API

The package ships `TheBuilder.DeliveryApiInspector`, so its public types and members are its API.
Each shipped project declares that API in `PublicAPI.Shipped.txt` (what the last stable release
shipped) and `PublicAPI.Unshipped.txt` (changes since then). Microsoft.CodeAnalysis.PublicApiAnalyzers
fails the build when the code and the files disagree. `Directory.Build.props` turns it on for every
project that has the files.

- Make new types `internal` unless a site is meant to implement, replace, configure or consume them.
- Controllers are public and ASP.NET only calls public constructors, so every type a controller's
  constructor takes is public.
- Adding public API: the RS0016 error quotes the exact line to add to `PublicAPI.Unshipped.txt`, and
  IDEs offer it as a code fix.
- Removing public API: when the line is in `PublicAPI.Unshipped.txt`, delete it. When the line is in
  `PublicAPI.Shipped.txt`, leave it there and add it to `PublicAPI.Unshipped.txt` with a `*REMOVED*`
  prefix. RS0017 names the line. This is a breaking change, so say so in the pull request.
- Keep both files in ordinal order (`LC_ALL=C sort`), with `#nullable enable` on the first line.
- Many lines at once:

  ```bash
  dotnet build src/TheBuilder.DeliveryApiInspector --no-incremental 2>&1 | grep 'error RS0016' | sed -E "s/^.*Symbol '//; s/' is not part of the declared public API.*//" | LC_ALL=C sort -u
  ```
