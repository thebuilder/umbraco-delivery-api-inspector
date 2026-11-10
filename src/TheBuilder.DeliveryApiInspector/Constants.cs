namespace TheBuilder.DeliveryApiInspector;

internal static class Constants
{
    public const string PackageName = "TheBuilder.DeliveryApiInspector";

    /// <summary>
    ///     Under the backoffice path, so the backoffice's bearer token is accepted. Version neutral: the
    ///     Delivery API picks its expand and fields syntax from the requested API version, and a request
    ///     with none gets the current (v2) syntax.
    /// </summary>
    public const string ApiRoot = "delivery-api-inspector/api";

    /// <summary>The path the Delivery API's own endpoints live under, for the request the backoffice shows.</summary>
    public const string DeliveryApiPath = "/umbraco/delivery/api/v2";
}
