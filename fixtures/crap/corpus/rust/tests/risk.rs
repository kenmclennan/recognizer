use crap_corpus::risk::*;

#[test]
fn small_functions() {
    assert_eq!(straight(1), 2);
    assert_eq!(one_if(true), 1);
    assert_eq!(one_if(false), 0);
    assert_eq!(if_else_if(1), "one");
    assert_eq!(if_else_if(3), "many");
    assert_eq!(loops(&[1, 2], 2), 3);
}

#[test]
fn larger_functions() {
    assert_eq!(match_three(1, false), "a");
    assert_eq!(match_three(9, true), "z");
    assert_eq!(if_let_match(Some(1), &[1], true, true), 5);
    assert_eq!(closure(&[1], 1), 4);
    assert_eq!(booleans(true, true, false, &[1], Some(1)), 3);
    assert_eq!(wide_match(2, &[1], 1), 21);
    assert_eq!(classify(5, false, false, false, false, &[1]), 4);
}
