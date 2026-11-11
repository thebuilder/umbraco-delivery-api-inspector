using TheBuilder.DeliveryApiInspector.ManagementApi;
using Umbraco.Cms.Core.Models.Membership;
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
///     Gives the Administrators group the inspector's permission, so administrators keep the tab they
///     had before access moved to user groups. Runs once: a group that drops it later stays without.
/// </summary>
internal sealed class GrantAdministrators(IMigrationContext context, IUserGroupService userGroups) : AsyncMigrationBase(context)
{
    protected override async Task MigrateAsync()
    {
        IUserGroup? administrators = await userGroups.GetAsync(UmbracoConstants.Security.AdminGroupKey);
        if (administrators is null || !administrators.Permissions.Add(InspectorAccessHandler.Permission))
        {
            return;
        }

        await userGroups.UpdateAsync(administrators, UmbracoConstants.Security.SuperUserKey);
    }
}
