pub mod memory;

pub trait Store {
    fn save(&self, order: &Order);

    fn name(&self) -> String {
        String::from("store")
    }
}
