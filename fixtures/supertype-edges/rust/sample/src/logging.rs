use crate::contract::Dispatcher;

pub struct LoggingDispatcher {
    inner: Box<dyn Dispatcher>,
}

impl Dispatcher for LoggingDispatcher {
    fn dispatch(&self, message: &str) {
        self.inner.dispatch(message);
    }
}
