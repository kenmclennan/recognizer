pub fn straight(a: i32) -> i32 {
    let b = a + 1;
    b
}

pub fn one_if(a: bool) -> i32 {
    if a {
        return 1;
    }
    0
}

pub fn if_else_if(a: i32) -> &'static str {
    if a == 1 {
        return "one";
    } else if a == 2 {
        return "two";
    }
    "many"
}

pub fn loops(xs: &[i32], a: i32) -> i32 {
    let mut total = 0;
    let mut n = a;
    for x in xs {
        total += x;
    }
    while n > 0 {
        n -= 1;
    }
    if total > 5 {
        total = 5;
    }
    total
}

pub fn match_three(v: i32, a: bool) -> &'static str {
    let mut r = match v {
        1 => "a",
        2 => "b",
        _ => "c",
    };
    if a {
        r = "z";
    }
    r
}

pub fn if_let_match(o: Option<i32>, xs: &[i32], a: bool, b: bool) -> i32 {
    let mut total = 0;
    if let Some(v) = o {
        total += v;
    }
    match xs.len() {
        0 => total += 1,
        _ => total += 2,
    }
    for x in xs {
        total += x;
    }
    let both = a && b;
    total + both as i32
}

pub fn closure(xs: &[i32], a: i32) -> i32 {
    let pick = |z: i32| {
        if z > 0 {
            1
        } else {
            2
        }
    };
    let mut total = pick(a);
    let mut n = a;
    while n > 0 {
        n -= 1;
    }
    for x in xs {
        total += x;
    }
    match total {
        0 => total = 1,
        _ => total += 1,
    }
    if total > 9 {
        total = 9;
    }
    total
}

pub fn booleans(a: bool, b: bool, c: bool, xs: &[i32], o: Option<i32>) -> i32 {
    let mut x = 0;
    if a && b || c {
        x = 1;
    }
    let mut p = a;
    while p || b {
        p = false;
    }
    for y in xs {
        x += y;
    }
    if let Some(v) = o {
        x += v;
    }
    x
}

pub fn wide_match(v: i32, xs: &[i32], a: i32) -> i32 {
    let mut r = match v {
        1 => 10,
        2 => 20,
        3 => 30,
        4 => 40,
        _ => 50,
    };
    for x in xs {
        r += x;
    }
    let mut n = a;
    while n > 0 {
        n -= 1;
    }
    if r > 100 {
        r = 100;
    }
    r
}

pub fn classify(n: i32, a: bool, b: bool, c: bool, d: bool, xs: &[i32]) -> i32 {
    let mut label = 0;
    if n < 0 {
        label = 1;
    } else if n == 0 {
        label = 2;
    } else if n < 10 {
        label = 3;
    } else if n < 100 {
        label = 4;
    }
    let ok = a || b || c && d;
    for x in xs {
        label += x;
    }
    let mut m = n;
    while m > 1 {
        m /= 2;
    }
    label + ok as i32
}

pub fn sprawl_match(v: i32, o: Option<i32>, xs: &[i32], a: bool, b: bool, c: bool) -> i32 {
    let mut r = match v {
        1 => 1,
        2 => 2,
        3 => 3,
        4 => 4,
        5 => 5,
        _ => 6,
    };
    if let Some(n) = o {
        r += n;
    }
    for x in xs {
        r += x;
    }
    let ok = a && b && c;
    r + ok as i32
}

pub fn sprawl(n: i32, xs: &[i32], a: i32, v: i32, b: bool, c: bool) -> i32 {
    let mut label = 0;
    if n < 0 {
        label = 0;
    } else if n == 0 {
        label = 1;
    } else if n < 10 {
        label = 2;
    } else if n < 100 {
        label = 3;
    } else if n < 1000 {
        label = 4;
    } else if n < 10000 {
        label = 5;
    }
    for x in xs {
        label += x;
    }
    let mut m = a;
    while m > 0 {
        m -= 1;
    }
    match v {
        1 => label += 1,
        _ => label += 2,
    }
    let extra = b || c;
    label + extra as i32
}
