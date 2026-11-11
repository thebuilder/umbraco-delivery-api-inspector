using TheBuilder.DeliveryApiInspector.ManagementApi;
using Umbraco.Cms.Core.Models.Membership;
using Umbraco.Cms.Core.Models.Membership.Permissions;
using Umbraco.Cms.Core.Packaging;
using Umbraco.Cms.Core.Services;
using Umbraco.Cms.Infrastructure.Migrations;
using UmbracoConstants = Umbraco.Cms.Core.Constants;

namespace TheBuilder.DeliveryApiInspector.Migrations;

/// <summary>The package's migrations, run once each by Umbraco's package migrations on startup.</summary>
internal sealed class InspectorMigrationPlan : PackageMigrationPlan
{
    public InspectorMigrationPlan()
        : base(Constants.PackageName)
    {
    }

    protected override void DefinePlan() =>
        To<GrantAdministrators>(new Guid("8c6f4d2a-5b1e-4a7c-9f3d-2e8b7a1c0d41"));
}

/// <summary>
///     Gives the Administrators group the inspector's permission, so administrators see the tab once the
///     package is installed. Per-document entries replace the group's defaults on their part of the tree,
///     so every document with entries gets the permission too. Runs once: a group that drops it later
///     stays without.
/// </summary>
internal sealed class GrantAdministrators(IMigrationContext context, IUserGroupService userGroups) : AsyncMigrationBase(context)
{
    protected override async Task MigrateAsync()
    {
        IUserGroup? administrators = await userGroups.GetAsync(UmbracoConstants.Security.AdminGroupKey);
        if (administrators is null)
        {
            return;
        }

        var changed = administrators.Permissions.Add(InspectorAccessHandler.Permission);

        Guid[] documents = administrators.GranularPermissions
            .OfType<DocumentGranularPermission>()
            .Select(granular => granular.Key)
            .Distinct()
            .ToArray();
        foreach (Guid document in documents)
        {
            changed |= administrators.GranularPermissions.Add(
                new DocumentGranularPermission { Key = document, Permission = InspectorAccessHandler.Permission });
        }

        if (changed)
        {
            await userGroups.UpdateAsync(administrators, UmbracoConstants.Security.SuperUserKey);
        }
    }
}
