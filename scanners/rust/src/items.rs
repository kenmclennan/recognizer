use std::collections::{BTreeMap, BTreeSet, HashMap};

use proc_macro2::{LineColumn, Span};
use serde_json::{json, Map, Value};
use syn::spanned::Spanned;
use syn::{
    Expr, FnArg, Item, ItemImpl, ItemTrait, Lit, Meta, Pat, ReturnType, Signature, TraitItem, Type,
    TypeParamBound, UseTree, Visibility,
};

const VALUE_LIMIT: usize = 40;

pub struct ModDecl {
    pub name: String,
    pub line: usize,
    pub path_attr: Option<String>,
    pub scope: Vec<String>,
}

pub struct UseLeaf {
    pub path: Vec<String>,
    pub leading_colon: bool,
    pub binding: String,
    pub glob: bool,
    pub public: bool,
    pub line: usize,
}

pub struct ImplRef {
    pub scope: Vec<String>,
    pub line: usize,
    pub trait_path: Vec<String>,
    pub leading_colon: bool,
    pub type_name: String,
}

#[derive(Default)]
pub struct Scope {
    pub uses: Vec<UseLeaf>,
    pub declared: BTreeSet<String>,
    pub inline: BTreeSet<String>,
}

pub struct Parsed {
    pub members: Vec<Value>,
    pub scopes: BTreeMap<Vec<String>, Scope>,
    pub mods: Vec<ModDecl>,
    pub impls: Vec<ImplRef>,
}

struct Text {
    source: String,
    starts: Vec<usize>,
}

impl Text {
    fn new(source: &str) -> Text {
        let mut starts = vec![0];

        for (index, byte) in source.bytes().enumerate() {
            if byte == b'\n' {
                starts.push(index + 1);
            }
        }

        Text {
            source: source.to_string(),
            starts,
        }
    }

    fn offset(&self, position: LineColumn) -> usize {
        let start = self.starts[position.line.saturating_sub(1).min(self.starts.len() - 1)];
        let rest = &self.source[start..];

        start
            + rest
                .char_indices()
                .nth(position.column)
                .map_or(rest.len(), |(index, _)| index)
    }

    fn slice(&self, span: Span) -> String {
        let from = self.offset(span.start());
        let to = self.offset(span.end()).max(from);

        collapse(&self.source[from..to])
    }
}

fn collapse(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn shorten(text: String) -> String {
    if text.chars().count() <= VALUE_LIMIT {
        return text;
    }

    let head: String = text.chars().take(VALUE_LIMIT - 1).collect();

    format!("{head}…")
}

fn name_of(ident: &syn::Ident) -> String {
    let text = ident.to_string();

    text.strip_prefix("r#").map_or(text.clone(), str::to_string)
}

fn line_of(span: Span) -> usize {
    span.start().line
}

fn is_public(visibility: &Visibility) -> bool {
    match visibility {
        Visibility::Public(_) => true,
        Visibility::Restricted(restricted) => {
            !(restricted.in_token.is_none() && restricted.path.is_ident("self"))
        }
        Visibility::Inherited => false,
    }
}

fn path_attribute(attributes: &[syn::Attribute]) -> Option<String> {
    attributes.iter().find_map(|attribute| {
        let Meta::NameValue(pair) = &attribute.meta else {
            return None;
        };

        if !pair.path.is_ident("path") {
            return None;
        }

        match &pair.value {
            Expr::Lit(literal) => match &literal.lit {
                Lit::Str(text) => Some(text.value()),
                _ => None,
            },
            _ => None,
        }
    })
}

fn flatten(tree: &UseTree, prefix: &mut Vec<String>, found: &mut Vec<(Vec<String>, String, bool)>) {
    match tree {
        UseTree::Path(path) => {
            prefix.push(name_of(&path.ident));
            flatten(&path.tree, prefix, found);
            prefix.pop();
        }
        UseTree::Name(name) => {
            let ident = name_of(&name.ident);

            if ident == "self" {
                let binding = prefix.last().cloned().unwrap_or(ident);

                found.push((prefix.clone(), binding, false));
            } else {
                let mut path = prefix.clone();

                path.push(ident.clone());
                found.push((path, ident, false));
            }
        }
        UseTree::Rename(rename) => {
            let ident = name_of(&rename.ident);
            let binding = name_of(&rename.rename);

            if ident == "self" {
                found.push((prefix.clone(), binding, false));
            } else {
                let mut path = prefix.clone();

                path.push(ident);
                found.push((path, binding, false));
            }
        }
        UseTree::Glob(_) => found.push((prefix.clone(), "*".to_string(), true)),
        UseTree::Group(group) => {
            for inner in &group.items {
                flatten(inner, prefix, found);
            }
        }
    }
}

fn last_segment(path: &syn::Path) -> Option<String> {
    path.segments.last().map(|segment| name_of(&segment.ident))
}

fn type_name(ty: &Type) -> Option<String> {
    match ty {
        Type::Path(path) => last_segment(&path.path),
        Type::Group(group) => type_name(&group.elem),
        Type::Paren(paren) => type_name(&paren.elem),
        _ => None,
    }
}

fn parameters(signature: &Signature, text: &Text) -> Vec<Value> {
    signature
        .inputs
        .iter()
        .filter_map(|argument| match argument {
            FnArg::Receiver(_) => None,
            FnArg::Typed(typed) => {
                let name = match typed.pat.as_ref() {
                    Pat::Ident(ident) => name_of(&ident.ident),
                    other => text.slice(other.span()),
                };

                Some(json!({"name": name, "type": text.slice(typed.ty.span())}))
            }
        })
        .collect()
}

fn returns(signature: &Signature, text: &Text) -> Option<String> {
    match &signature.output {
        ReturnType::Type(_, ty) => Some(text.slice(ty.span())),
        ReturnType::Default => None,
    }
}

fn tags(signature: &Signature, is_static: bool, is_abstract: bool) -> Vec<&'static str> {
    let mut found = Vec::new();

    if is_static {
        found.push("static");
    }

    if is_abstract {
        found.push("abstract");
    }

    if signature.asyncness.is_some() {
        found.push("async");
    }

    found
}

fn method(signature: &Signature, private: bool, is_abstract: bool, text: &Text) -> Value {
    let mut found = Map::new();

    found.insert("name".into(), json!(name_of(&signature.ident)));
    found.insert("line".into(), json!(line_of(signature.ident.span())));
    found.insert("params".into(), json!(parameters(signature, text)));
    found.insert("private".into(), json!(private));

    if let Some(output) = returns(signature, text) {
        found.insert("returns".into(), json!(output));
    }

    let marks = tags(signature, signature.receiver().is_none(), is_abstract);

    if !marks.is_empty() {
        found.insert("tags".into(), json!(marks));
    }

    Value::Object(found)
}

fn impl_methods(block: &ItemImpl, text: &Text) -> Vec<Value> {
    let in_trait = block.trait_.is_some();

    block
        .items
        .iter()
        .filter_map(|item| match item {
            syn::ImplItem::Fn(function) => Some(method(
                &function.sig,
                !in_trait && !is_public(&function.vis),
                false,
                text,
            )),
            _ => None,
        })
        .collect()
}

fn trait_methods(block: &ItemTrait, text: &Text) -> Vec<Value> {
    block
        .items
        .iter()
        .filter_map(|item| match item {
            TraitItem::Fn(function) => Some(method(
                &function.sig,
                false,
                function.default.is_none(),
                text,
            )),
            _ => None,
        })
        .collect()
}

fn member(name: &str, kind: &str, line: usize, exported: bool) -> Map<String, Value> {
    let mut found = Map::new();

    found.insert("name".into(), json!(name));
    found.insert("kind".into(), json!(kind));
    found.insert("line".into(), json!(line));
    found.insert("exported".into(), json!(exported));

    found
}

fn fields(fields: &syn::Fields, text: &Text) -> Vec<Value> {
    match fields {
        syn::Fields::Named(named) => named
            .named
            .iter()
            .filter_map(|field| {
                let ident = field.ident.as_ref()?;

                Some(json!({
                    "name": name_of(ident),
                    "line": line_of(ident.span()),
                    "private": !is_public(&field.vis),
                    "type": text.slice(field.ty.span()),
                }))
            })
            .collect(),
        syn::Fields::Unnamed(unnamed) => unnamed
            .unnamed
            .iter()
            .enumerate()
            .map(|(index, field)| {
                json!({
                    "name": index.to_string(),
                    "line": line_of(field.ty.span()),
                    "private": !is_public(&field.vis),
                    "type": text.slice(field.ty.span()),
                })
            })
            .collect(),
        syn::Fields::Unit => Vec::new(),
    }
}

pub fn parse(source: &str) -> Result<Parsed, String> {
    let file = syn::parse_file(source).map_err(|error| error.to_string())?;
    let text = Text::new(source);
    let mut parsed = Parsed {
        members: Vec::new(),
        scopes: BTreeMap::new(),
        mods: Vec::new(),
        impls: Vec::new(),
    };
    let mut methods: HashMap<String, Vec<Value>> = HashMap::new();

    for item in &file.items {
        if let Item::Impl(block) = item {
            if let Some(name) = type_name(&block.self_ty) {
                methods
                    .entry(name)
                    .or_default()
                    .extend(impl_methods(block, &text));
            }
        }
    }

    parsed.scopes.entry(Vec::new()).or_default();
    collect(&file.items, &mut Vec::new(), &mut parsed, &text, &methods);

    Ok(parsed)
}

fn declare(parsed: &mut Parsed, scope: &[String], name: String) {
    parsed
        .scopes
        .entry(scope.to_vec())
        .or_default()
        .declared
        .insert(name);
}

fn collect(
    items: &[Item],
    scope: &mut Vec<String>,
    parsed: &mut Parsed,
    text: &Text,
    methods: &HashMap<String, Vec<Value>>,
) {
    let top = scope.is_empty();

    for item in items {
        match item {
            Item::Use(import) => {
                let mut found = Vec::new();

                flatten(&import.tree, &mut Vec::new(), &mut found);

                for (path, binding, glob) in found {
                    let leaf = UseLeaf {
                        path,
                        leading_colon: import.leading_colon.is_some(),
                        binding,
                        glob,
                        public: is_public(&import.vis),
                        line: line_of(import.use_token.span),
                    };

                    parsed
                        .scopes
                        .entry(scope.clone())
                        .or_default()
                        .uses
                        .push(leaf);
                }
            }
            Item::Mod(module) => {
                let name = name_of(&module.ident);

                match &module.content {
                    Some((_, inner)) => {
                        parsed
                            .scopes
                            .entry(scope.clone())
                            .or_default()
                            .inline
                            .insert(name.clone());
                        scope.push(name);
                        parsed.scopes.entry(scope.clone()).or_default();
                        collect(inner, scope, parsed, text, methods);
                        scope.pop();
                    }
                    None => parsed.mods.push(ModDecl {
                        name,
                        line: line_of(module.mod_token.span),
                        path_attr: path_attribute(&module.attrs),
                        scope: scope.clone(),
                    }),
                }
            }
            Item::Impl(block) => {
                if let Some((None, path, _)) = &block.trait_ {
                    if let (Some(_), Some(name)) = (last_segment(path), type_name(&block.self_ty)) {
                        parsed.impls.push(ImplRef {
                            scope: scope.clone(),
                            line: line_of(block.impl_token.span),
                            trait_path: path.segments.iter().map(|s| name_of(&s.ident)).collect(),
                            leading_colon: path.leading_colon.is_some(),
                            type_name: name,
                        });
                    }
                }
            }
            Item::Struct(found) => {
                let name = name_of(&found.ident);

                declare(parsed, scope, name.clone());

                if top {
                    let mut value = member(
                        &name,
                        "class",
                        line_of(found.ident.span()),
                        is_public(&found.vis),
                    );

                    value.insert("fields".into(), json!(fields(&found.fields, text)));
                    value.insert(
                        "methods".into(),
                        json!(methods.get(&name).cloned().unwrap_or_default()),
                    );
                    parsed.members.push(Value::Object(value));
                }
            }
            Item::Enum(found) => {
                let name = name_of(&found.ident);

                declare(parsed, scope, name.clone());

                if top {
                    let mut value = member(
                        &name,
                        "class",
                        line_of(found.ident.span()),
                        is_public(&found.vis),
                    );

                    value.insert(
                        "methods".into(),
                        json!(methods.get(&name).cloned().unwrap_or_default()),
                    );
                    parsed.members.push(Value::Object(value));
                }
            }
            Item::Trait(found) => {
                let name = name_of(&found.ident);

                declare(parsed, scope, name.clone());

                if top {
                    let mut value = member(
                        &name,
                        "interface",
                        line_of(found.ident.span()),
                        is_public(&found.vis),
                    );
                    let bases: Vec<String> = found
                        .supertraits
                        .iter()
                        .filter(|bound| matches!(bound, TypeParamBound::Trait(_)))
                        .map(|bound| text.slice(bound.span()))
                        .collect();

                    value.insert("bases".into(), json!(bases));
                    value.insert("methods".into(), json!(trait_methods(found, text)));
                    parsed.members.push(Value::Object(value));
                }
            }
            Item::Fn(found) => {
                let name = name_of(&found.sig.ident);

                declare(parsed, scope, name.clone());

                if top {
                    let mut value = member(
                        &name,
                        "function",
                        line_of(found.sig.ident.span()),
                        is_public(&found.vis),
                    );

                    value.insert("params".into(), json!(parameters(&found.sig, text)));

                    if let Some(output) = returns(&found.sig, text) {
                        value.insert("returns".into(), json!(output));
                    }

                    let marks = tags(&found.sig, false, false);

                    if !marks.is_empty() {
                        value.insert("tags".into(), json!(marks));
                    }

                    parsed.members.push(Value::Object(value));
                }
            }
            Item::Const(found) => {
                let name = name_of(&found.ident);

                declare(parsed, scope, name.clone());

                if top && name != "_" {
                    let mut value = member(
                        &name,
                        "constant",
                        line_of(found.ident.span()),
                        is_public(&found.vis),
                    );

                    value.insert(
                        "value".into(),
                        json!(shorten(text.slice(found.expr.span()))),
                    );
                    parsed.members.push(Value::Object(value));
                }
            }
            Item::Static(found) => {
                let name = name_of(&found.ident);

                declare(parsed, scope, name.clone());

                if top {
                    let mut value = member(
                        &name,
                        "constant",
                        line_of(found.ident.span()),
                        is_public(&found.vis),
                    );

                    value.insert(
                        "value".into(),
                        json!(shorten(text.slice(found.expr.span()))),
                    );
                    parsed.members.push(Value::Object(value));
                }
            }
            Item::Union(found) => declare(parsed, scope, name_of(&found.ident)),
            Item::Type(found) => declare(parsed, scope, name_of(&found.ident)),
            Item::TraitAlias(found) => declare(parsed, scope, name_of(&found.ident)),
            Item::Macro(found) if found.mac.path.is_ident("macro_rules") => {
                if let Some(ident) = &found.ident {
                    declare(parsed, scope, name_of(ident));
                }
            }
            _ => {}
        }
    }
}
