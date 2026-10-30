use std::collections::HashMap;

use crate::ports::Store;

pub struct SqlStore {
    rows: HashMap<u32, u64>,
}

impl Store for SqlStore {
    fn save(&self, order: &Order) {
        let _ = (order, &self.rows);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
}
