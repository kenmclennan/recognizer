namespace Shop.Domain;

public static class OrderExtensions
{
    extension(Order order)
    {
        public int ItemCount() => order.Lines.Length;
    }
}
