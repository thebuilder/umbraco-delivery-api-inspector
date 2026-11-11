using System.Diagnostics;
using System.Globalization;
using Asp.Versioning;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using TheBuilder.DeliveryApiInspector.Configuration;
using Umbraco.Cms.Core.Actions;
using Umbraco.Cms.Core.Configuration.Models;
using Umbraco.Cms.Core.DeliveryApi;
using Umbraco.Cms.Core.Models.DeliveryApi;
using Umbraco.Cms.Core.Models.Membership;
using Umbraco.Cms.Core.Models.PublishedContent;
using Umbraco.Cms.Core.PublishedCache;
using Umbraco.Cms.Core.Security;
using Umbraco.Cms.Core.Services;
using Umbraco.Cms.Core.Services.AuthorizationStatus;
using Umbraco.Cms.Infrastructure.DeliveryApi;
using Umbraco.Cms.Web.Common.Authorization;
using Umbraco.Cms.Web.Common.Routing;
using UmbracoConstants = Umbraco.Cms.Core.Constants;

namespace TheBuilder.DeliveryApiInspector.ManagementApi;

/// <summary>
///     The backoffice endpoints behind the API tab. Each builds the response the Delivery API would
///     return for a document or media item, in-process and with the same builders, so draft content
///     shows without an API key in the browser and the tab works when the public Delivery API is off.
/// </summary>
[ApiController]
[ApiVersionNeutral]
[BackOfficeRoute(Constants.ApiRoot)]
[Authorize(Policy = AuthorizationPolicies.BackOfficeAccess)]
[ApiExplorerSettings(IgnoreApi = true)]
[ResponseCache(Location = ResponseCacheLocation.None, NoStore = true)]
public sealed class InspectorController(
    IBackOfficeSecurityAccessor securityAccessor,
    IOptionsMonitor<DeliveryApiInspectorOptions> options,
    IOptionsMonitor<DeliveryApiSettings> deliveryApiSettings,
    IVariationContextAccessor variationContextAccessor,
    IOptionsMonitor<JsonOptions> jsonOptions,
    ILogger<InspectorController> logger) : ControllerBase
{
    /// <summary>
    ///     Whether the current user may use the tab, and the Delivery API settings the tab needs to show
    ///     the request a frontend would send.
    /// </summary>
    [HttpGet("config")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public IActionResult Config()
    {
        DeliveryApiInspectorOptions inspector = options.CurrentValue;
        DeliveryApiSettings delivery = deliveryApiSettings.CurrentValue;
        IUser? user = securityAccessor.BackOfficeSecurity?.CurrentUser;
        bool allowed = InspectorAccessHandler.IsAllowed(user, inspector);
        // The keys of the document and media types by alias, so a type badge can open its type. Only
        // for users who can open Settings, where those types are edited.
        bool settings = allowed && user?.AllowedSections.Contains(UmbracoConstants.Applications.Settings) == true;
        return Ok(new
        {
            allowed,
            media = allowed && inspector.Media,
            documentTypes = settings
                ? HttpContext.RequestServices.GetRequiredService<IContentTypeService>().GetAll().ToDictionary(type => type.Alias, type => type.Key)
                : null,
            mediaTypes = settings
                ? HttpContext.RequestServices.GetRequiredService<IMediaTypeService>().GetAll().ToDictionary(type => type.Alias, type => type.Key)
                : null,
            deliveryApi = new
            {
                // Whether the site called AddDeliveryApi(); without it there is nothing to show.
                installed = HttpContext.RequestServices.GetService<IApiContentResponseBuilder>() is not null,
                enabled = delivery.Enabled,
                publicAccess = delivery.PublicAccess,
                mediaEnabled = delivery.Media.Enabled,
                mediaPublicAccess = delivery.Media.PublicAccess,
                hasApiKey = !string.IsNullOrWhiteSpace(delivery.ApiKey),
                path = Constants.DeliveryApiPath,
            },
        });
    }

    /// <summary>
    ///     The Delivery API response for a document, as <c>GET /umbraco/delivery/api/v2/content/item/{id}</c>
    ///     returns it. Takes the Delivery API's own <c>expand</c> and <c>fields</c> parameters.
    /// </summary>
    /// <param name="id">The document's key.</param>
    /// <param name="preview">The draft (true) or the published version (false).</param>
    /// <param name="culture">The culture of a variant document, as the Accept-Language header would give it.</param>
    /// <param name="segment">The segment, as the Accept-Segment header would give it.</param>
    [HttpGet("content/{id:guid}")]
    [Authorize(Policy = InspectorAccessRequirement.Policy)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Content(Guid id, bool preview = true, string? culture = null, string? segment = null)
    {
        IApiPublishedContentCache? cache = HttpContext.RequestServices.GetService<IApiPublishedContentCache>();
        IApiContentResponseBuilder? builder = HttpContext.RequestServices.GetService<IApiContentResponseBuilder>();
        if (cache is null || builder is null)
        {
            return NotInstalled();
        }

        if (!await MayBrowseContent(id))
        {
            return NotFoundProblem("The document does not exist, or you cannot browse it.");
        }

        return await Build(preview, culture, segment, async () =>
        {
            IPublishedContent? content = await cache.GetByIdAsync(id);
            if (content is null)
            {
                return (null, preview
                    ? "The Delivery API has nothing for this document. It may be in the recycle bin, or its type may be excluded from the Delivery API."
                    : "This document is not published in this culture.");
            }

            return (builder.Build(content), "The Delivery API leaves this document out, for example because its type is excluded.");
        });
    }

    /// <summary>
    ///     The Delivery API response for a media item, as <c>GET /umbraco/delivery/api/v2/media/item/{id}</c>
    ///     returns it.
    /// </summary>
    /// <param name="id">The media item's key.</param>
    [HttpGet("media/{id:guid}")]
    [Authorize(Policy = InspectorAccessRequirement.Policy)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Media(Guid id)
    {
        IPublishedMediaCache? cache = HttpContext.RequestServices.GetService<IPublishedMediaCache>();
        IApiMediaWithCropsResponseBuilder? builder = HttpContext.RequestServices.GetService<IApiMediaWithCropsResponseBuilder>();
        if (cache is null || builder is null)
        {
            return NotInstalled();
        }

        if (!options.CurrentValue.Media || !await MayBrowseMedia(id))
        {
            return NotFoundProblem("The media item does not exist, or you cannot browse it.");
        }

        return await Build(false, null, null, () =>
        {
            IPublishedContent? media = cache.GetById(id);
            return Task.FromResult<(object?, string)>(media is null
                ? (null, "The Delivery API has nothing for this media item. It may be in the recycle bin.")
                : (builder.Build(media), "The Delivery API leaves this media item out."));
        });
    }

    private async Task<IActionResult> Build(bool preview, string? culture, string? segment, Func<Task<(object? Response, string Missing)>> build)
    {
        // The Delivery API's services read the request's headers, so set them as a frontend would
        // send them. The backoffice's own Accept-Language is the editor's browser language, not a
        // content culture, so it never reaches them.
        // The Delivery API reads expand and fields with the syntax of the requested API version, and
        // the backoffice's routes are version 1. Ask for the version the shown request uses.
        // (Asp.Versioning 8 on Umbraco 17 and 10 on 18 both have the feature type; only 8 has the
        // HttpContext extension for it.)
        IApiVersioningFeature versioning = HttpContext.Features.Get<IApiVersioningFeature>() ?? new ApiVersioningFeature(HttpContext);
        HttpContext.Features.Set(versioning);
        versioning.RequestedApiVersion = new ApiVersion(2, 0);

        IHeaderDictionary headers = HttpContext.Request.Headers;
        headers.Remove("Accept-Language");
        headers.Remove("Accept-Segment");
        headers.Remove("Preview");
        if (!string.IsNullOrWhiteSpace(culture))
        {
            headers["Accept-Language"] = culture;
        }

        if (!string.IsNullOrWhiteSpace(segment))
        {
            headers["Accept-Segment"] = segment;
        }

        if (preview)
        {
            headers["Preview"] = "true";
        }

        // What the Delivery API's ContextualizeFromAcceptHeaders filter does.
        if (!string.IsNullOrWhiteSpace(culture) || !string.IsNullOrWhiteSpace(segment))
        {
            variationContextAccessor.VariationContext = new VariationContext(
                string.IsNullOrWhiteSpace(culture) ? variationContextAccessor.VariationContext?.Culture : culture,
                string.IsNullOrWhiteSpace(segment) ? variationContextAccessor.VariationContext?.Segment : segment);
        }

        Stopwatch stopwatch = Stopwatch.StartNew();
        object? response;
        string missing;
        try
        {
            (response, missing) = await build();
        }
        catch (ArgumentException exception) when (exception.Message.Contains("'expand'", StringComparison.Ordinal) || exception.Message.Contains("'fields'", StringComparison.Ordinal))
        {
            // The Delivery API answers a malformed expand or fields with this message.
            return Problem(statusCode: StatusCodes.Status400BadRequest, title: exception.Message);
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Could not build the Delivery API response for the API tab.");
            return Problem(statusCode: StatusCodes.Status500InternalServerError, title: $"Building the response failed: {exception.Message}");
        }

        if (response is null)
        {
            return NotFoundProblem(missing);
        }

        Response.Headers["Server-Timing"] = string.Create(CultureInfo.InvariantCulture, $"build;dur={stopwatch.Elapsed.TotalMilliseconds:0.0}");
        return new JsonResult(response, jsonOptions.Get(UmbracoConstants.JsonOptionsNames.DeliveryApi).JsonSerializerOptions);
    }

    private async Task<bool> MayBrowseContent(Guid id)
    {
        IUser? user = securityAccessor.BackOfficeSecurity?.CurrentUser;
        IContentPermissionService permissions = HttpContext.RequestServices.GetRequiredService<IContentPermissionService>();
        return user is not null
            && await permissions.AuthorizeAccessAsync(user, id, ActionBrowse.ActionLetter) == ContentAuthorizationStatus.Success;
    }

    private async Task<bool> MayBrowseMedia(Guid id)
    {
        IUser? user = securityAccessor.BackOfficeSecurity?.CurrentUser;
        IMediaPermissionService permissions = HttpContext.RequestServices.GetRequiredService<IMediaPermissionService>();
        return user is not null
            && await permissions.AuthorizeAccessAsync(user, id) == MediaAuthorizationStatus.Success;
    }

    private ObjectResult NotFoundProblem(string title) => Problem(statusCode: StatusCodes.Status404NotFound, title: title);

    private ObjectResult NotInstalled() => Problem(
        statusCode: StatusCodes.Status501NotImplemented,
        title: "The Delivery API is not added to this site. Call AddDeliveryApi() in Program.cs.");
}
