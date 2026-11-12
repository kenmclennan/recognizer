struct Store<T> {
    items: Vec<T>,
}

impl<T: Clone> Store<T> {
    fn get(&self, index: usize) -> Option<T> {
        if index < self.items.len() {
            Some(self.items[index].clone())
        } else {
            None
        }
    }

    fn get(&self, index: usize, fallback: T) -> T {
        self.items.get(index).cloned().unwrap_or(fallback)
    }
}

trait Shape {
    fn area(&self) -> f64 {
        0.0
    }
}

mod helpers {
    pub fn double(value: i32) -> i32 {
        value * 2
    }
}
