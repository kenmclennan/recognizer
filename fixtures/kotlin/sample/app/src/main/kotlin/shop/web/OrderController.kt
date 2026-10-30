package shop.web

import io.micronaut.http.annotation.Controller
import io.micronaut.http.annotation.Get
import shop.application.PlaceOrder
import shop.config.BASE
import shop.domain.*

@Controller
class OrderController(private val placeOrder: PlaceOrder) {

    @Get("$BASE/orders")
    fun list(): String = "orders"

    fun place(order: Order): Int {
        placeOrder.execute(order)

        return order.total()
    }
}
