namespace Shop.Domain;

public interface IOrderStore
{
    void Save(Order order);
}
