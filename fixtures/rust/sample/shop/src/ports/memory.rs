use super::Store;
use crate::Order;

pub struct MemoryStore;

impl Store for MemoryStore {
    fn save(&self, order: &Order) {
        let _ = order;
    }
}
