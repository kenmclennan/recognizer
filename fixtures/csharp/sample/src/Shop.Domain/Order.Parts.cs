namespace Shop.Domain;

public partial class Order
{
    public Product Main { get; } = new Product();
}
