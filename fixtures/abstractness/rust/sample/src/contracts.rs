pub trait Store {
    fn save(&self);
}

pub trait Named: Store {
    fn name(&self) -> String;
}
