package shop.clients

import io.micronaut.http.annotation.Post
import io.micronaut.http.client.annotation.Client
import shop.domain.Order

@Client("/payments")
interface PaymentClient {

    @Post
    fun charge(order: Order): Boolean
}
