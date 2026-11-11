using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.DependencyInjection;
using TheBuilder.DeliveryApiInspector.Configuration;
using TheBuilder.DeliveryApiInspector.ManagementApi;
using Umbraco.Cms.Core.Composing;
using Umbraco.Cms.Core.DependencyInjection;

namespace TheBuilder.DeliveryApiInspector.Composition;

/// <summary>
///     Installs the package: the API tab on documents and media, and the backoffice endpoints behind it.
///     Settings are under <c>DeliveryApiInspector</c>.
/// </summary>
public sealed class DeliveryApiInspectorComposer : IComposer
{
    /// <inheritdoc />
    public void Compose(IUmbracoBuilder builder)
    {
        builder.Services.AddOptions<DeliveryApiInspectorOptions>()
            .Bind(builder.Config.GetSection(DeliveryApiInspectorOptions.SectionName));
        builder.Services.AddSingleton<IAuthorizationHandler, InspectorAccessHandler>();
        builder.Services.AddAuthorization(options => options.AddPolicy(
            InspectorAccessRequirement.Policy,
            policy => policy.AddRequirements(new InspectorAccessRequirement())));
    }
}
