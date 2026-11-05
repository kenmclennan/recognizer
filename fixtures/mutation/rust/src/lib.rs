pub fn add(a: i32, b: i32) -> i32 {
    a + b
}

pub fn mul(a: i32, b: i32) -> i32 {
    a * b
}

pub fn neg(a: i32) -> i32 {
    -a
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unit_neg() {
        assert_eq!(neg(2), -2);
    }
}
