mod a;
mod plain;

#[cfg(test)]
mod tests;

#[cfg(test)]
#[path = "t.rs"]
mod renamed;

#[cfg(test)]
mod checks;

#[cfg(test)]
mod gone;

#[cfg(all(test, unix))]
mod gated;

#[cfg(any(test, unix))]
mod prod_or_test;
