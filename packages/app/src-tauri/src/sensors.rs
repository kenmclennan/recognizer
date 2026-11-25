use std::fs;
use std::path::Path;

pub fn modified_ms(path: &Path) -> Option<f64> {
    fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|elapsed| elapsed.as_millis() as f64)
}
