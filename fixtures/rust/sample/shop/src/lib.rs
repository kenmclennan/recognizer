mod orders;
pub mod ports;
mod adapters;

pub use orders::Order;

pub const MAX_LINES: usize = 100;

static REGISTRY: &str = "orders";

pub fn open() -> Order {
    Order::new(0, 0)
}
