class Limits:
    def retry_limit(self):
        env = self._env_int("APP_RETRY_LIMIT", None)
        if env is not None:
            return env
        return self._required_int("retry-limit")

    def page_size(self):
        env = self._env_int("APP_PAGE_SIZE", None)
        if env is not None:
            return env
        return self._required_int("page-size")
