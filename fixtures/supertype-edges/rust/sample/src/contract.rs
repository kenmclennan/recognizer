pub trait Dispatcher {
    fn dispatch(&self, message: &str);
}

pub trait Idle {
    fn idle(&self);
}
