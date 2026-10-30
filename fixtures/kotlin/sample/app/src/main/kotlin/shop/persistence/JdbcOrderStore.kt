package shop.persistence

import shop.domain.Order
import shop.generated.OrderRecord
import shop.ports.OrderStore

class JdbcOrderStore(private val repository: OrderRepository) : OrderStore {

    override fun save(order: Order) {
        repository.save(order)
    }

    private fun record(order: Order): OrderRecord = OrderRecord(order.id)
}
