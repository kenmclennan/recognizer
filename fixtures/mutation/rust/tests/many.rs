mod common;

use calc::{mul, neg};

#[test]
fn muls() {
    assert_eq!(mul(common::two(), 3), 6);
}

#[test]
fn negs() {
    assert_eq!(neg(common::two()), -2);
}
