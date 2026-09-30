//! `lq read` (Deno `cli.ts` read branch).

use super::common::{CliError, assert_no_selector_mistakes, print_json, push_warning};
use crate::ast::{Document, NodeId, NodeKind};
use crate::query::{build_traversal_state_index, query};
use crate::text_utils::{
    TextRegion, TraversalState, advance_traversal_state, enter_traversal_state, traversal_region,
};
use crate::tracked_changes::{
    annotate_changes_with_state, extract_all_text, is_change_closer, is_change_opener,
};
use serde_json::{Map, Value, json};
use std::collections::HashMap;

fn node_label(doc: &Document, id: NodeId) -> String {
    match &doc.node(id).kind {
        NodeKind::Block { tag, args, .. } => {
            format!("{}[{}]", tag, args.as_deref().unwrap_or("").trim())
        }
        NodeKind::Property { key, .. } => format!("property[{key}]"),
        NodeKind::Text { .. } => "text".into(),
        NodeKind::Document => "document".into(),
    }
}

fn block_prefix(doc: &Document, id: NodeId) -> String {
    match &doc.node(id).kind {
        NodeKind::Block { tag, args, .. } => {
            format!("{}[{}]", tag, args.as_deref().unwrap_or("").trim())
        }
        _ => String::new(),
    }
}

fn set_inline_region(out: &mut String, open: &mut TextRegion, next: TextRegion) {
    if *open == next {
        return;
    }
    if *open != TextRegion::Current {
        out.push('}');
    }
    match next {
        TextRegion::Deleted => out.push_str("\\change_deleted{"),
        TextRegion::Inserted => out.push_str("\\change_inserted{"),
        TextRegion::Current => {}
    }
    *open = next;
}

fn append_contextual_children(
    doc: &Document,
    node: NodeId,
    inherited: &TraversalState,
    out: &mut String,
    open: &mut TextRegion,
) {
    let mut state = enter_traversal_state(inherited);
    for &child in &doc.node(node).children {
        match &doc.node(child).kind {
            NodeKind::Property { key, value } if is_change_opener(key) || is_change_closer(key) => {
                set_inline_region(out, open, TextRegion::Current);
                advance_traversal_state(&mut state, key, value.as_deref());
                set_inline_region(out, open, traversal_region(&state));
            }
            NodeKind::Block { tag, .. } if tag != "inset" => {
                append_contextual_children(doc, child, &state, out, open);
                set_inline_region(out, open, traversal_region(&state));
            }
            _ => {
                set_inline_region(out, open, traversal_region(&state));
                out.push_str(&extract_all_text(doc, child, usize::MAX, false));
            }
        }
    }
}

fn contextual_text(doc: &Document, node: NodeId, state: Option<&TraversalState>) -> String {
    if matches!(
        doc.node(node).kind,
        NodeKind::Property { .. } | NodeKind::Document
    ) {
        return extract_all_text(doc, node, usize::MAX, false);
    }
    let Some(state) = state.filter(|state| traversal_region(state) != TextRegion::Current) else {
        return extract_all_text(doc, node, usize::MAX, false);
    };
    let mut text = String::new();
    let mut open = TextRegion::Current;
    set_inline_region(&mut text, &mut open, traversal_region(state));
    if matches!(&doc.node(node).kind, NodeKind::Block { tag, .. } if tag != "inset") {
        append_contextual_children(doc, node, state, &mut text, &mut open);
    } else {
        text.push_str(&extract_all_text(doc, node, usize::MAX, false));
    }
    set_inline_region(&mut text, &mut open, TextRegion::Current);
    text
}

fn text_of_node(doc: &Document, id: NodeId, traversal: &HashMap<NodeId, TraversalState>) -> String {
    if let NodeKind::Block { tag, .. } = &doc.node(id).kind
        && tag == "inset"
    {
        let layouts: Vec<NodeId> = doc
            .node(id)
            .children
            .iter()
            .copied()
            .filter(|&child| {
                matches!(&doc.node(child).kind, NodeKind::Block { tag, .. } if tag == "layout")
            })
            .collect();
        if !layouts.is_empty() {
            return layouts
                .into_iter()
                .map(|layout| {
                    let args = match &doc.node(layout).kind {
                        NodeKind::Block { args, .. } => args.as_deref().unwrap_or("").trim(),
                        _ => "",
                    };
                    format!(
                        "layout[{args}] {}",
                        contextual_text(doc, layout, traversal.get(&layout)).trim()
                    )
                })
                .collect::<Vec<_>>()
                .join("\n");
        }
    }
    contextual_text(doc, id, traversal.get(&id))
        .trim()
        .to_string()
}

fn js_utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

pub fn run_read(
    ast: &Document,
    selector: Option<&str>,
    count_only: bool,
    text_only: bool,
) -> Result<(), CliError> {
    let Some(selector) = selector.filter(|s| !s.is_empty()) else {
        return Err(CliError::new(
            "MISSING_SELECTOR",
            "A CSS selector is required for this command. Run 'lq help selectors' for selector syntax.",
        ));
    };

    let nodes = match query(ast, selector) {
        Ok(nodes) => nodes,
        Err(error) => return Err(CliError::new("INVALID_SELECTOR", error.message)),
    };
    assert_no_selector_mistakes(Some(selector))?;

    let mut result = Map::new();
    let traversal = if !count_only || text_only {
        build_traversal_state_index(ast, ast.root())
    } else {
        HashMap::new()
    };

    if count_only {
        let mut tally = Map::new();
        for &node in &nodes {
            let label = node_label(ast, node);
            let next = tally.get(&label).and_then(Value::as_u64).unwrap_or(0) + 1;
            tally.insert(label, json!(next));
        }
        result.insert("count".into(), Value::Object(tally));
    }

    if text_only {
        let mut texts = Vec::new();
        for &node in &nodes {
            let prefix = block_prefix(ast, node);
            let text = text_of_node(ast, node, &traversal);
            let combined = if prefix.is_empty() {
                text
            } else {
                format!("{prefix} {text}")
            };
            if !combined.is_empty() {
                texts.push(combined);
            }
        }
        let output = format!("{}\n", texts.join("\n\n"));
        let utf16_len = js_utf16_len(&output);
        if utf16_len > 10 * 1024 {
            let size_kb = (utf16_len as f64 / 1024.0).round() as u64;
            push_warning(format!(
                "--text-only output is {size_kb}KB across {} nodes. Consider a more specific selector to reduce noise.",
                nodes.len()
            ));
        }
        result.insert("text".into(), json!(output));
    }

    if !count_only && !text_only {
        let data: Vec<Value> = nodes
            .iter()
            .map(|&n| annotate_changes_with_state(ast, n, traversal.get(&n)))
            .collect();
        result.insert("data".into(), Value::Array(data));
        result.insert("count".into(), json!(nodes.len()));
    }

    print_json(Value::Object(result));
    Ok(())
}
