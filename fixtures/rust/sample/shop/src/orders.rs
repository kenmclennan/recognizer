use pricing::discount;
use serde::Serialize;

use crate::ports::Store;

pub struct Order {
    pub id: u32,
    total: u64,
}

impl Order {
    pub fn new(id: u32, total: u64) -> Order {
        Order { id, total }
    }

    fn subtotal(&self) -> u64 {
        self.total - discount(self.total)
    }
}

pub enum Status {
    Open,
    Closed,
}
