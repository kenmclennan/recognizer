namespace Shop.Application;

public class OrderService(IOrderStore store)
{
    public string Place(Order order)
    {
        store.Save(order);

        return order.ItemCount().ToString().Shout();
    }
}
