pub(crate) const RATE: u64 = 15;

pub fn discount(total: u64) -> u64 {
    round(total * RATE / 100)
}

fn round(value: u64) -> u64 {
    value
}

#[test]
fn free_standing_test() {
    assert_eq!(round(1), 1);
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_TOTAL: u64 = 100;

    #[test]
    fn discount_is_fifteen_percent() {
        assert_eq!(discount(SAMPLE_TOTAL), 15);
    }

    fn helper() -> u64 {
        round(SAMPLE_TOTAL)
    }
}
