using Shop.Domain;

namespace Shop.Infrastructure;

public class SqlOrderStore : IOrderStore
{
    public void Save(Order order)
    {
        var now = Clock.Now();
    }
}
