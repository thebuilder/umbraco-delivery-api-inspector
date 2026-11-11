using Umbraco.Cms.Core;
using Umbraco.Cms.Core.Events;
using Umbraco.Cms.Core.Models.Membership;
using Umbraco.Cms.Core.Models.Membership.Permissions;
using Umbraco.Cms.Core.Notifications;
using Umbraco.Cms.Core.Services;
using Umbraco.Cms.Infrastructure.Install;

namespace TheBuilder.DeliveryApiInspector.Example.Seeding;

/// <summary>
///     Installs the package the way an existing site gets it: once the example content is in, Administrators
///     gets permissions of its own on the About page, and then the package's migrations run again from the
///     start. The end-to-end check reads the result, so it covers the migration on a site where
///     Administrators sets permissions on part of the tree. Runs once per database.
/// </summary>
internal sealed class ExampleInstallSeeder(
    IRuntimeState runtimeState,
    IKeyValueService keyValues,
    IUserGroupService userGroups,
    PackageMigrationRunner packageMigrations,
    ILogger<ExampleInstallSeeder> logger)
    : INotificationAsyncHandler<UmbracoApplicationStartedNotification>
{
    private const string Package = "TheBuilder.DeliveryApiInspector";
    private const string Permission = "TheBuilder.DeliveryApiInspector.View";
    private const string Done = "TheBuilder.DeliveryApiInspector.Example.Installed";

    /// <summary>Where Umbraco keeps how far a package's migrations have run.</summary>
    private const string MigrationState = "Umbraco.Core.Upgrader.State+" + Package;

    public async Task HandleAsync(UmbracoApplicationStartedNotification notification, CancellationToken cancellationToken)
    {
        if (runtimeState.Level != RuntimeLevel.Run || keyValues.GetValue(Done) is not null)
        {
            return;
        }

        IUserGroup administrators = await userGroups.GetAsync(Constants.Security.AdminGroupKey)
            ?? throw new InvalidOperationException("The Administrators group is missing.");

        logger.LogInformation("Installing the package again, on a site where Administrators has permissions on the About page.");

        // The same verbs as the group's defaults, without the inspector's, as on a site that set them before
        // the package was installed.
        administrators.Permissions.Remove(Permission);
        foreach (var verb in administrators.Permissions)
        {
            administrators.GranularPermissions.Add(new DocumentGranularPermission { Key = ExampleContent.About, Permission = verb });
        }

        await userGroups.UpdateAsync(administrators, Constants.Security.SuperUserKey);

        keyValues.SetValue(MigrationState, string.Empty);
        await packageMigrations.RunPackageMigrationsIfPendingAsync(Package);
        keyValues.SetValue(Done, "1");
    }
}
