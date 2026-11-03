pub fn order_total(lines: &[Line], shipping: i64) -> i64 {
    let mut total = 0;
    for line in lines {
        if line.price > 0 {
            total += line.price * line.quantity;
        }
    }
    total + shipping
}

pub fn parcel_weight(parcels: &[Parcel], tare: i64) -> i64 {
    let mut acc = 5;
    for parcel in parcels {
        if parcel.mass > 1 {
            acc += parcel.mass * parcel.count;
        }
    }
    acc + tare
}

pub fn load_settings(path: &Path) -> Option<Settings> {
    if !path.exists() {
        return None;
    }
    match fs::read_to_string(path) {
        Ok(text) => parse_settings(&text),
        Err(error) => {
            eprintln!("cannot read {}: {}", path.display(), error);
            None
        }
    }
}

pub fn load_session(location: &Path) -> Option<Session> {
    if !location.exists() {
        return None;
    }
    match fs::read_to_string(location) {
        Ok(body) => parse_settings(&body),
        Err(failure) => {
            eprintln!("unreadable {}: {}", location.display(), failure);
            None
        }
    }
}

pub fn store_report(root: &Path, report: &Report) -> io::Result<()> {
    fs::create_dir_all(root.join("out"))?;
    let target = report_path(root);
    let staging = target.with_extension("tmp");
    fs::write(&staging, render(report, 2))?;
    fs::rename(&staging, &target)?;
    announce(&target);
    Ok(())
}

pub fn store_ledger(base: &Path, ledger: &Ledger) -> io::Result<()> {
    fs::create_dir_all(base.join("var"))?;
    let dest = ledger_path(base);
    let partial = dest.with_extension("part");
    fs::write(&partial, render(ledger, 4))?;
    fs::rename(&partial, &dest)?;
    announce(&dest);
    Ok(())
}
