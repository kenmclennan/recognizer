pub struct Limits;

impl Limits {
    pub fn retry_limit(&self) -> i64 {
        self.settings.section("limits").entry(
            "retry-limit",
            0,
        )
    }

    pub fn page_size(&self) -> i64 {
        self.settings.section("limits").entry(
            "page-size",
            0,
        )
    }

    pub fn queue_depth(&self) -> i64 {
        self.settings.section("limits").entry(
            "queue-depth",
            0,
        )
    }

    pub fn idle_timeout(&self) -> i64 {
        self.settings.section("limits").entry(
            "idle-timeout",
            0,
        )
    }
}
