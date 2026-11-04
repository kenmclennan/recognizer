using Shop.Domain;
using Shop.Infrastructure;
using SimpleInjector;

namespace Shop.Web;

public static class CompositionRoot
{
    public static void Compose(Container container, Assembly[] assemblies)
    {
        container.Register<IOrderStore, SqlOrderStore>();
        container.Register(typeof(IHandler<>), assemblies);
    }
}
