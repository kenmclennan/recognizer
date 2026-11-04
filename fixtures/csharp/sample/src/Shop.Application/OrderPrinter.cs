using static Shop.Domain.Pricing;
using Lines = Shop.Domain.OrderLine;

namespace Shop.Application;

public class OrderPrinter
{
    private readonly Lines? line = null;

    public int Total() => Round(Tax);
}
