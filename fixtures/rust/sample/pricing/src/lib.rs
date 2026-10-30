pub(crate) const RATE: u64 = 15;

pub fn discount(total: u64) -> u64 {
    round(total * RATE / 100)
}

fn round(value: u64) -> u64 {
    value
}
