package shop.domain

data class Order(val id: Long, val amount: Int)

fun Order.total(): Int = amount
