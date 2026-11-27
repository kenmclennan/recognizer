use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::views::valid_name;

pub const LIMIT: usize = 10;

pub const VIEW_LIMIT: usize = 5;

pub trait RecentFoldersRepository {
    fn load(&self) -> Vec<PathBuf>;
    fn store(&self, list: &[PathBuf]) -> Result<(), String>;
}

pub trait RecentViewsRepository {
    fn load(&self) -> BTreeMap<String, Vec<String>>;
    fn store(&self, all: &BTreeMap<String, Vec<String>>) -> Result<(), String>;
}

pub fn with_opened(list: &[PathBuf], folder: &Path) -> Vec<PathBuf> {
    let mut next = vec![folder.to_path_buf()];

    next.extend(
        list.iter()
            .filter(|entry| entry.as_path() != folder)
            .cloned(),
    );
    next.truncate(LIMIT);

    next
}

pub fn without(list: &[PathBuf], folder: &Path) -> Vec<PathBuf> {
    list.iter()
        .filter(|entry| entry.as_path() != folder)
        .cloned()
        .collect()
}

pub fn recent_folders(repository: &dyn RecentFoldersRepository) -> Vec<PathBuf> {
    let mut list = Vec::new();

    for entry in repository.load() {
        if !list.contains(&entry) {
            list.push(entry);
        }
    }

    list.truncate(LIMIT);

    list
}

pub fn record(
    repository: &dyn RecentFoldersRepository,
    folder: &Path,
) -> Result<Vec<PathBuf>, String> {
    let next = with_opened(&recent_folders(repository), folder);

    repository.store(&next)?;

    Ok(next)
}

pub fn forget(
    repository: &dyn RecentFoldersRepository,
    folder: &Path,
) -> Result<Vec<PathBuf>, String> {
    let next = without(&recent_folders(repository), folder);

    repository.store(&next)?;

    Ok(next)
}

pub fn clear(repository: &dyn RecentFoldersRepository) -> Result<Vec<PathBuf>, String> {
    repository.store(&[])?;

    Ok(Vec::new())
}

pub fn read_recent_views(repository: &dyn RecentViewsRepository, folder: &Path) -> Vec<String> {
    repository
        .load()
        .remove(&folder.display().to_string())
        .unwrap_or_default()
}

pub fn record_recent_view(
    repository: &dyn RecentViewsRepository,
    folder: &Path,
    name: &str,
) -> Result<(), String> {
    if !valid_name(name) {
        return Err(format!("{name:?} is not a valid view name"));
    }

    let mut all = repository.load();
    let list = all.entry(folder.display().to_string()).or_default();

    list.retain(|existing| existing != name);
    list.insert(0, name.to_string());
    list.truncate(VIEW_LIMIT);

    repository.store(&all)
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};

    pub mod contract {
        use super::*;

        pub fn recent_folders_repository(repository: &dyn RecentFoldersRepository) {
            assert!(repository.load().is_empty());

            repository.store(&[PathBuf::from("/a")]).unwrap();

            assert!(!repository.load().is_empty());
            assert_eq!(repository.load(), vec![PathBuf::from("/a")]);

            repository
                .store(&[PathBuf::from("/b"), PathBuf::from("/c")])
                .unwrap();

            assert_eq!(
                repository.load(),
                vec![PathBuf::from("/b"), PathBuf::from("/c")]
            );
        }

        pub fn recent_views_repository(repository: &dyn RecentViewsRepository) {
            assert!(repository.load().is_empty());

            let mut first = BTreeMap::new();

            first.insert("/one".to_string(), vec!["a".to_string()]);
            repository.store(&first).unwrap();

            assert!(!repository.load().is_empty());
            assert_eq!(repository.load(), first);

            let mut second = BTreeMap::new();

            second.insert("/two".to_string(), vec!["z".to_string()]);
            repository.store(&second).unwrap();

            assert_eq!(repository.load(), second);
        }
    }

    #[derive(Default)]
    struct FakeFolders {
        list: RefCell<Vec<PathBuf>>,
    }

    impl RecentFoldersRepository for FakeFolders {
        fn load(&self) -> Vec<PathBuf> {
            self.list.borrow().clone()
        }

        fn store(&self, list: &[PathBuf]) -> Result<(), String> {
            *self.list.borrow_mut() = list.to_vec();

            Ok(())
        }
    }

    #[derive(Default)]
    struct FakeViews {
        all: RefCell<BTreeMap<String, Vec<String>>>,
        stores: Cell<usize>,
    }

    impl RecentViewsRepository for FakeViews {
        fn load(&self) -> BTreeMap<String, Vec<String>> {
            self.all.borrow().clone()
        }

        fn store(&self, all: &BTreeMap<String, Vec<String>>) -> Result<(), String> {
            *self.all.borrow_mut() = all.clone();
            self.stores.set(self.stores.get() + 1);

            Ok(())
        }
    }

    fn paths(names: &[&str]) -> Vec<PathBuf> {
        names.iter().map(PathBuf::from).collect()
    }

    fn folders_holding(names: &[&str]) -> FakeFolders {
        let fake = FakeFolders::default();

        fake.store(&paths(names)).unwrap();

        fake
    }

    #[test]
    fn the_fake_meets_the_recent_folders_contract() {
        contract::recent_folders_repository(&FakeFolders::default());
    }

    #[test]
    fn the_fake_meets_the_recent_views_contract() {
        contract::recent_views_repository(&FakeViews::default());
    }

    #[test]
    fn an_opened_folder_goes_first() {
        let fake = folders_holding(&["/a", "/b"]);

        assert_eq!(
            record(&fake, Path::new("/c")).unwrap(),
            paths(&["/c", "/a", "/b"])
        );
        assert_eq!(fake.load(), paths(&["/c", "/a", "/b"]));
    }

    #[test]
    fn reopening_a_folder_moves_it_first_without_a_duplicate() {
        let fake = folders_holding(&["/a", "/b", "/c"]);

        assert_eq!(
            record(&fake, Path::new("/c")).unwrap(),
            paths(&["/c", "/a", "/b"])
        );
        assert_eq!(fake.load(), paths(&["/c", "/a", "/b"]));
    }

    #[test]
    fn the_list_holds_the_last_ten() {
        let full: Vec<PathBuf> = (0..LIMIT)
            .map(|n| PathBuf::from(format!("/f{n}")))
            .collect();
        let fake = FakeFolders::default();

        fake.store(&full).unwrap();

        let next = record(&fake, Path::new("/new")).unwrap();

        assert_eq!(next.len(), LIMIT);
        assert_eq!(next[0], PathBuf::from("/new"));
        assert!(!next.contains(&PathBuf::from(format!("/f{}", LIMIT - 1))));
        assert_eq!(fake.load(), next);
    }

    #[test]
    fn removing_drops_only_that_folder() {
        let fake = folders_holding(&["/a", "/b", "/c"]);

        assert_eq!(
            forget(&fake, Path::new("/b")).unwrap(),
            paths(&["/a", "/c"])
        );
        assert_eq!(fake.load(), paths(&["/a", "/c"]));
    }

    #[test]
    fn clearing_stores_an_empty_list() {
        let fake = folders_holding(&["/a"]);

        assert!(clear(&fake).unwrap().is_empty());
        assert!(fake.load().is_empty());
    }

    #[test]
    fn a_stored_list_with_duplicates_and_excess_is_normalised_on_read() {
        let mut entries: Vec<String> = (0..15).map(|n| format!("/f{n}")).collect();

        entries.insert(1, "/f0".to_string());

        let fake = FakeFolders::default();

        fake.store(&entries.iter().map(PathBuf::from).collect::<Vec<_>>())
            .unwrap();

        assert_eq!(fake.load().len(), 16);

        let list = recent_folders(&fake);

        assert_eq!(list.len(), LIMIT);
        assert_eq!(list[0], PathBuf::from("/f0"));
        assert_eq!(list[1], PathBuf::from("/f1"));
    }

    #[test]
    fn a_view_name_that_is_not_valid_is_refused_and_nothing_is_stored() {
        let fake = FakeViews::default();

        record_recent_view(&fake, Path::new("/one"), "a").unwrap();

        assert_eq!(fake.stores.get(), 1);
        assert!(record_recent_view(&fake, Path::new("/one"), "../x").is_err());
        assert_eq!(fake.stores.get(), 1);
        assert_eq!(read_recent_views(&fake, Path::new("/one")), ["a"]);
    }

    #[test]
    fn the_views_list_holds_exactly_five() {
        let fake = FakeViews::default();

        for name in ["a", "b", "c", "d", "e", "f"] {
            record_recent_view(&fake, Path::new("/one"), name).unwrap();
        }

        let list = read_recent_views(&fake, Path::new("/one"));

        assert_eq!(list.len(), VIEW_LIMIT);
        assert_eq!(list, ["f", "e", "d", "c", "b"]);
    }

    #[test]
    fn recording_a_view_again_moves_it_first_and_keys_by_folder() {
        let fake = FakeViews::default();

        for name in ["a", "b", "a"] {
            record_recent_view(&fake, Path::new("/one"), name).unwrap();
        }

        record_recent_view(&fake, Path::new("/two"), "z").unwrap();

        assert_eq!(read_recent_views(&fake, Path::new("/one")), ["a", "b"]);
        assert_eq!(read_recent_views(&fake, Path::new("/two")), ["z"]);
    }
}
