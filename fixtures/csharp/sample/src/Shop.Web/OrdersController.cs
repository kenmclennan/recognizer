using Microsoft.AspNetCore.Mvc;
using Shop.Application;
using Shop.Domain;
using Shop.Domain.Extensions;

namespace Shop.Web;

public class OrdersController(OrderService service) : ControllerBase
{
    public string Show(Order order)
    {
        var started = Clock.Now();

        return service.Place(order).Shout();
    }
}
