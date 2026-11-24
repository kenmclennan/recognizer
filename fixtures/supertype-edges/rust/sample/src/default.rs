use crate::contract::Dispatcher;

pub struct DefaultDispatcher;

impl Dispatcher for DefaultDispatcher {
    fn dispatch(&self, _message: &str) {}
}
