pub type Id = String;

pub type Handler = fn(i32) -> i32;

pub struct Row {
    pub id: Id,
}

pub struct Impl;

pub enum Color {
    Red,
}

pub fn build() -> Impl {
    Impl
}

pub const LIMIT: i32 = 3;

struct Hidden;
