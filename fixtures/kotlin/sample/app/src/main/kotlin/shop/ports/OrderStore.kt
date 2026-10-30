package shop.ports

import shop.domain.Order

interface OrderStore {
    fun save(order: Order)
}
