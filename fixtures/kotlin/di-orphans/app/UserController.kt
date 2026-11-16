package demo

@Controller("/users")
class UserController(private val users: GetUserPort) {
    fun show(id: String) = users.get(id)
}
