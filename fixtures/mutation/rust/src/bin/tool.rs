use calc::add;

fn main() {
    println!("{}", 3);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bin_add() {
        assert_eq!(add(1, 2), 3);
    }
}
