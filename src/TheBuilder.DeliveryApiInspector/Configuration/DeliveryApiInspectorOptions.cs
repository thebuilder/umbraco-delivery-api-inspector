namespace TheBuilder.DeliveryApiInspector.Configuration;

/// <summary>Settings under <c>DeliveryApiInspector</c> in appsettings.</summary>
public sealed class DeliveryApiInspectorOptions
{
    /// <summary>The appsettings section the options bind to.</summary>
    public const string SectionName = "DeliveryApiInspector";

    /// <summary>Whether the API tab shows at all. On by default.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>Whether the API tab shows on media items too. On by default.</summary>
    public bool Media { get; set; } = true;

    /// <summary>
    ///     The aliases of user groups that see the API tab on every item, whatever their permissions. The
    ///     View Delivery API output permission, set under Users, User groups, grants it too. Empty by
    ///     default.
    /// </summary>
    public IList<string> UserGroups { get; set; } = [];
}
