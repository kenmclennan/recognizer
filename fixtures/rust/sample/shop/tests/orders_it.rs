use shop::Order;

#[test]
fn builds_an_order() {
    let _ = Order::new(1, 1);
}
