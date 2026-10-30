package shop.application

import shop.domain.Order
import shop.ports.OrderStore as Store

@UseCase
class PlaceOrder(private val store: Store) {

    fun execute(order: Order) {
        store.save(order)
    }
}
