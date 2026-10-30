package shop.persistence

import io.micronaut.data.jdbc.annotation.JdbcRepository
import io.micronaut.data.repository.CrudRepository
import shop.domain.Order

@JdbcRepository
interface OrderRepository : CrudRepository<Order, Long>
