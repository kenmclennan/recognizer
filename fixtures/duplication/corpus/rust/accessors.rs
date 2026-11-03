pub struct Limits;

impl Limits {
    pub fn retry_limit(&self) -> i64 {
        if let Some(env) = self.env_int("APP_RETRY_LIMIT") {
            return env;
        }
        self.required_int("retry-limit")
    }

    pub fn page_size(&self) -> i64 {
        if let Some(env) = self.env_int("APP_PAGE_SIZE") {
            return env;
        }
        self.required_int("page-size")
    }

    pub fn queue_depth(&self) -> i64 {
        if let Some(env) = self.env_int("APP_QUEUE_DEPTH") {
            return env;
        }
        self.required_int("queue-depth")
    }

    pub fn idle_timeout(&self) -> i64 {
        if let Some(env) = self.env_int("APP_IDLE_TIMEOUT") {
            return env;
        }
        self.required_int("idle-timeout")
    }
}
