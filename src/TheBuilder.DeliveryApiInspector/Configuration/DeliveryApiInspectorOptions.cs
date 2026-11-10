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
    ///     The aliases of the user groups that see the API tab. Empty, the default, means administrators
    ///     only.
    /// </summary>
    public IList<string> UserGroups { get; set; } = [];
}
