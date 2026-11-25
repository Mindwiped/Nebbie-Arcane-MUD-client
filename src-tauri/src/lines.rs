//! Spezza il testo decodificato in righe. Il testo senza `\n` finale resta in attesa:
//! è la "riga parziale" (tipicamente il prompt) che viene consegnata dopo GA/EOR o un timeout.

/// Oltre questa lunghezza una riga viene consegnata comunque (protezione da flussi anomali).
const MAX_LINE: usize = 64 * 1024;

#[derive(Default)]
pub struct LineAssembler {
    buf: String,
}

impl LineAssembler {
    pub fn new() -> Self {
        Self::default()
    }

    /// Aggiunge testo e restituisce le righe complete (senza `\r` e `\n`).
    pub fn push(&mut self, text: &str) -> Vec<String> {
        let mut out = Vec::new();
        for c in text.chars() {
            match c {
                '\n' => out.push(std::mem::take(&mut self.buf)),
                '\r' => {}
                c => {
                    self.buf.push(c);
                    if self.buf.len() >= MAX_LINE {
                        out.push(std::mem::take(&mut self.buf));
                    }
                }
            }
        }
        out
    }

    pub fn has_partial(&self) -> bool {
        !self.buf.is_empty()
    }

    /// Consegna la riga parziale, se c'è.
    pub fn take_partial(&mut self) -> Option<String> {
        (!self.buf.is_empty()).then(|| std::mem::take(&mut self.buf))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn righe_complete_e_parziale() {
        let mut a = LineAssembler::new();
        assert_eq!(a.push("uno\r\ndue\n\ntre"), vec!["uno", "due", ""]);
        assert!(a.has_partial());
        assert_eq!(a.take_partial().as_deref(), Some("tre"));
        assert_eq!(a.take_partial(), None);
    }

    #[test]
    fn riga_spezzata_tra_pacchetti() {
        let mut a = LineAssembler::new();
        assert!(a.push("Uscite: No").is_empty());
        assert_eq!(a.push("rd\n"), vec!["Uscite: Nord"]);
    }

    #[test]
    fn newline_seguito_da_cr() {
        let mut a = LineAssembler::new();
        assert_eq!(a.push("a\n\rb\n\r"), vec!["a", "b"]);
    }
}
