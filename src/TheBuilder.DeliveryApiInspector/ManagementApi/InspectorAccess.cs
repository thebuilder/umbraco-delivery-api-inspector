using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Options;
using TheBuilder.DeliveryApiInspector.Configuration;
using Umbraco.Cms.Core.Models.Membership;
using Umbraco.Cms.Core.Security;

namespace TheBuilder.DeliveryApiInspector.ManagementApi;

/// <summary>
///     Who may use the inspector: user groups with the inspector's document permission, which a group
///     can have by default or on parts of the content tree, and the user groups named in settings.
/// </summary>
internal sealed class InspectorAccessRequirement : IAuthorizationRequirement
{
    public const string Policy = "TheBuilder.DeliveryApiInspector.Access";
}

internal sealed class InspectorAccessHandler(
    IBackOfficeSecurityAccessor securityAccessor,
    IOptionsMonitor<DeliveryApiInspectorOptions> options)
    : AuthorizationHandler<InspectorAccessRequirement>
{
    /// <summary>
    ///     The document permission a user group ticks under Users, User groups, to see the API tab. The
    ///     backoffice registers the same verb in bundle.manifests.ts.
    /// </summary>
    public const string Permission = "TheBuilder.DeliveryApiInspector.View";

    protected override Task HandleRequirementAsync(AuthorizationHandlerContext context, InspectorAccessRequirement requirement)
    {
        if (IsAllowed(securityAccessor.BackOfficeSecurity?.CurrentUser, options.CurrentValue))
        {
            context.Succeed(requirement);
        }

        return Task.CompletedTask;
    }

    /// <summary>Whether the user may use the tab on some item: the gate for every endpoint.</summary>
    public static bool IsAllowed(IUser? user, DeliveryApiInspectorOptions options) =>
        user is not null
        && options.Enabled
        && (InNamedGroup(user, options)
            || user.Groups.Any(group => group.Permissions.Contains(Permission)
                || group.GranularPermissions.Any(granular => granular.Permission == Permission)));

    /// <summary>
    ///     Whether the user may use the tab on media. Media has no permissions per item, so this takes
    ///     the permission a group has by default for documents.
    /// </summary>
    public static bool IsAllowedForMedia(IUser? user, DeliveryApiInspectorOptions options) =>
        user is not null
        && options.Enabled
        && options.Media
        && (InNamedGroup(user, options) || user.Groups.Any(group => group.Permissions.Contains(Permission)));

    /// <summary>Whether settings name one of the user's groups, which allows every item.</summary>
    public static bool InNamedGroup(IUser user, DeliveryApiInspectorOptions options) =>
        user.Groups.Any(group => options.UserGroups.Contains(group.Alias, StringComparer.OrdinalIgnoreCase));
}
