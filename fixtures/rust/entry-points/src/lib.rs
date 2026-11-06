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
