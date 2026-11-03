class Limits:
    def retry_limit(self):
        return self._settings.section("limits").entry(
            "retry-limit",
            None,
        )

    def page_size(self):
        return self._settings.section("limits").entry(
            "page-size",
            None,
        )

    def queue_depth(self):
        return self._settings.section("limits").entry(
            "queue-depth",
            None,
        )

    def idle_timeout(self):
        return self._settings.section("limits").entry(
            "idle-timeout",
            None,
        )
