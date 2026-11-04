namespace Shop.Domain;

public interface IHandler<T>
{
    void Handle(T message);
}
