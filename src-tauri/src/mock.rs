//! Logica del finto server telnet (`mock-server`): divide un log in blocchi da mandare
//! uno per ogni comando ricevuto.
//!
//! - Log del client con i comandi (`C`): un blocco per ogni comando registrato.
//! - Testo semplice: si taglia subito dopo ogni fine-prompt (es. `>>` più lo spazio che
//!   segue). Il testo attaccato al prompt finisce nel blocco successivo, come succede con
//!   il server vero, che manda la risposta al comando senza andare a capo prima.

use crate::session_log::{Entry, Kind};

pub fn chunks(entries: &[Entry], prompt_end: &str) -> Vec<String> {
    if entries.iter().any(|e| e.kind == Kind::Command) {
        split_at_commands(entries)
    } else {
        split_at_prompts(entries, prompt_end)
    }
}

fn split_at_commands(entries: &[Entry]) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    for e in entries {
        match e.kind {
            Kind::Line => {
                current.push_str(&e.text);
                current.push_str("\r\n");
            }
            Kind::Partial => current.push_str(&e.text),
            Kind::Command => out.push(std::mem::take(&mut current)),
            Kind::System => {}
        }
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

fn split_at_prompts(entries: &[Entry], prompt_end: &str) -> Vec<String> {
    let mut text = String::new();
    for e in entries.iter().filter(|e| e.kind != Kind::System) {
        text.push_str(&e.text);
        if e.kind == Kind::Line {
            text.push_str("\r\n");
        }
    }
    if prompt_end.is_empty() {
        return vec![text];
    }
    let mut out = Vec::new();
    let mut rest = text.as_str();
    while let Some(pos) = rest.find(prompt_end) {
        let mut end = pos + prompt_end.len();
        if rest[end..].starts_with(' ') {
            end += 1;
        }
        // Se dopo il prompt la riga finisce, l'a capo resta nel blocco del prompt.
        if rest[end..].starts_with("\r\n") {
            end += 2;
        }
        out.push(rest[..end].to_string());
        rest = &rest[end..];
    }
    if !rest.is_empty() {
        out.push(rest.to_string());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session_log::parse;

    #[test]
    fn testo_attaccato_al_prompt_va_nel_blocco_dopo() {
        let entries = parse(
            "Benvenuto\nPg H1 M2 V3 X4>> Stai trasportando:\nuna pozione\nPg H1 M2 V3 X4>> \n",
        );
        let c = chunks(&entries, ">>");
        assert_eq!(
            c,
            vec![
                "Benvenuto\r\nPg H1 M2 V3 X4>> ",
                "Stai trasportando:\r\nuna pozione\r\nPg H1 M2 V3 X4>> \r\n",
            ]
        );
    }

    #[test]
    fn log_con_comandi_tagliato_ai_comandi() {
        let entries =
            parse("0\tL\tciao\n1\tP\tPg>> \n2\tC\tnord\n3\tL\tUscite: Sud\n4\tP\tPg>> \n");
        assert_eq!(
            chunks(&entries, ">>"),
            vec!["ciao\r\nPg>> ", "Uscite: Sud\r\nPg>> "]
        );
    }
}
