using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Options;
using TheBuilder.DeliveryApiInspector.Configuration;
using Umbraco.Cms.Core.Models.Membership;
using Umbraco.Cms.Core.Security;
using Umbraco.Extensions;

namespace TheBuilder.DeliveryApiInspector.ManagementApi;

/// <summary>Who may use the inspector: the configured user groups, or administrators when none are set.</summary>
internal sealed class InspectorAccessRequirement : IAuthorizationRequirement
{
    public const string Policy = "TheBuilder.DeliveryApiInspector.Access";
}

internal sealed class InspectorAccessHandler(
    IBackOfficeSecurityAccessor securityAccessor,
    IOptionsMonitor<DeliveryApiInspectorOptions> options)
    : AuthorizationHandler<InspectorAccessRequirement>
{
    protected override Task HandleRequirementAsync(AuthorizationHandlerContext context, InspectorAccessRequirement requirement)
    {
        if (IsAllowed(securityAccessor.BackOfficeSecurity?.CurrentUser, options.CurrentValue))
        {
            context.Succeed(requirement);
        }

        return Task.CompletedTask;
    }

    public static bool IsAllowed(IUser? user, DeliveryApiInspectorOptions options)
    {
        if (user is null || !options.Enabled)
        {
            return false;
        }

        return options.UserGroups.Count == 0
            ? user.IsAdmin()
            : user.Groups.Any(group => options.UserGroups.Contains(group.Alias, StringComparer.OrdinalIgnoreCase));
    }
}
