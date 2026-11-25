//! Analisi delle sequenze ANSI: trasforma una riga in span `{testo, colori, stile}`.
//! Lo stile resta attivo da una riga all'altra, come in un terminale.
//!
//! Colori: `0..=255` è un indice della tavolozza (0-15 i colori base, 16-255 xterm),
//! `TRUECOLOR | 0xRRGGBB` è un colore a 24 bit. La tavolozza vera sta nel frontend (temi).

use serde::Serialize;

pub const TRUECOLOR: u32 = 0x0100_0000;
const TAB_WIDTH: usize = 8;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct Style {
    fg: Option<u32>,
    bg: Option<u32>,
    bold: bool,
    dim: bool,
    italic: bool,
    underline: bool,
    inverse: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct Span {
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fg: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bg: Option<u32>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub bold: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub dim: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub italic: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub underline: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub inverse: bool,
}

impl Span {
    fn new(text: String, s: Style) -> Self {
        Self {
            text,
            fg: s.fg,
            bg: s.bg,
            bold: s.bold,
            dim: s.dim,
            italic: s.italic,
            underline: s.underline,
            inverse: s.inverse,
        }
    }
}

#[derive(Default)]
pub struct AnsiParser {
    style: Style,
    /// Sequenza di escape rimasta a metà alla fine della riga precedente.
    pending: String,
}

impl AnsiParser {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn parse_line(&mut self, line: &str) -> Vec<Span> {
        let owned;
        let line = if self.pending.is_empty() {
            line
        } else {
            owned = std::mem::take(&mut self.pending) + line;
            owned.as_str()
        };

        let mut spans = Vec::new();
        let mut text = String::new();
        let mut col = 0usize;
        let mut chars = line.char_indices().peekable();

        while let Some((i, c)) = chars.next() {
            match c {
                '\x1b' => match chars.peek() {
                    None => {
                        self.pending = line[i..].to_string();
                        break;
                    }
                    Some(&(_, '[')) => {
                        chars.next();
                        let mut params = String::new();
                        let mut final_byte = None;
                        for (_, p) in chars.by_ref() {
                            if ('\x40'..='\x7e').contains(&p) {
                                final_byte = Some(p);
                                break;
                            }
                            params.push(p);
                        }
                        match final_byte {
                            Some('m') => {
                                let before = self.style;
                                self.apply_sgr(&params);
                                if self.style != before && !text.is_empty() {
                                    spans.push(Span::new(std::mem::take(&mut text), before));
                                }
                            }
                            Some(_) => {} // altre sequenze CSI: ignorate
                            None => {
                                self.pending = line[i..].to_string();
                                break;
                            }
                        }
                    }
                    Some(_) => {
                        chars.next(); // ESC + un carattere: ignorato
                    }
                },
                '\t' => {
                    let n = TAB_WIDTH - (col % TAB_WIDTH);
                    text.extend(std::iter::repeat_n(' ', n));
                    col += n;
                }
                c if c.is_control() => {} // \r, campanello e altri caratteri di controllo
                c => {
                    text.push(c);
                    col += 1;
                }
            }
        }
        if !text.is_empty() {
            spans.push(Span::new(text, self.style));
        }
        spans
    }

    fn apply_sgr(&mut self, params: &str) {
        let nums: Vec<u32> = if params.is_empty() {
            vec![0]
        } else {
            params
                .split([';', ':'])
                .map(|p| p.parse().unwrap_or(0))
                .collect()
        };
        let s = &mut self.style;
        let mut i = 0;
        while i < nums.len() {
            match nums[i] {
                0 => *s = Style::default(),
                1 => s.bold = true,
                2 => s.dim = true,
                3 => s.italic = true,
                4 => s.underline = true,
                7 => s.inverse = true,
                22 => {
                    s.bold = false;
                    s.dim = false;
                }
                23 => s.italic = false,
                24 => s.underline = false,
                27 => s.inverse = false,
                n @ 30..=37 => s.fg = Some(n - 30),
                n @ 40..=47 => s.bg = Some(n - 40),
                n @ 90..=97 => s.fg = Some(n - 90 + 8),
                n @ 100..=107 => s.bg = Some(n - 100 + 8),
                39 => s.fg = None,
                49 => s.bg = None,
                n @ (38 | 48) => {
                    let (color, used) = extended_color(&nums[i + 1..]);
                    if let Some(color) = color {
                        if n == 38 {
                            s.fg = Some(color);
                        } else {
                            s.bg = Some(color);
                        }
                    }
                    i += used;
                }
                _ => {}
            }
            i += 1;
        }
    }
}

/// Legge `5;n` (256 colori) o `2;r;g;b` (truecolor). Restituisce il colore e quanti numeri ha usato.
fn extended_color(rest: &[u32]) -> (Option<u32>, usize) {
    match rest {
        [5, n, ..] => (Some((*n).min(255)), 2),
        [2, r, g, b, ..] => (
            Some(TRUECOLOR | ((*r).min(255) << 16) | ((*g).min(255) << 8) | (*b).min(255)),
            4,
        ),
        [5] | [2, ..] => (None, rest.len()),
        _ => (None, 0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plain(text: &str) -> Span {
        Span::new(text.into(), Style::default())
    }

    #[test]
    fn riga_senza_colori() {
        let mut p = AnsiParser::new();
        assert_eq!(
            p.parse_line("Uscite: Nord Est"),
            vec![plain("Uscite: Nord Est")]
        );
    }

    #[test]
    fn colori_base_e_reset() {
        let mut p = AnsiParser::new();
        let spans = p.parse_line("a\x1b[1;31mrosso\x1b[0mb");
        assert_eq!(spans.len(), 3);
        assert_eq!(spans[1].text, "rosso");
        assert_eq!(spans[1].fg, Some(1));
        assert!(spans[1].bold);
        assert_eq!(spans[2], plain("b"));
    }

    #[test]
    fn lo_stile_continua_sulla_riga_dopo() {
        let mut p = AnsiParser::new();
        p.parse_line("\x1b[32mverde");
        let spans = p.parse_line("ancora");
        assert_eq!(spans[0].fg, Some(2));
    }

    #[test]
    fn colori_256_e_truecolor() {
        let mut p = AnsiParser::new();
        let spans = p.parse_line("\x1b[38;5;208ma\x1b[48;2;1;2;3mb");
        assert_eq!(spans[0].fg, Some(208));
        assert_eq!(spans[1].bg, Some(TRUECOLOR | 0x010203));
    }

    #[test]
    fn colori_chiari() {
        let mut p = AnsiParser::new();
        assert_eq!(p.parse_line("\x1b[93mx")[0].fg, Some(11));
    }

    #[test]
    fn tab_espanso_e_controlli_tolti() {
        let mut p = AnsiParser::new();
        assert_eq!(p.parse_line("ab\tc\r\x07"), vec![plain("ab      c")]);
    }

    #[test]
    fn altre_sequenze_csi_ignorate() {
        let mut p = AnsiParser::new();
        assert_eq!(p.parse_line("\x1b[2Jpulito\x1b[K"), vec![plain("pulito")]);
    }

    #[test]
    fn escape_a_meta_ripreso_alla_riga_dopo() {
        let mut p = AnsiParser::new();
        assert_eq!(p.parse_line("a\x1b[3"), vec![plain("a")]);
        assert_eq!(p.parse_line("1mb")[0].fg, Some(1));
    }

    #[test]
    fn span_vuoti_non_generati() {
        let mut p = AnsiParser::new();
        assert!(p.parse_line("\x1b[31m\x1b[0m").is_empty());
    }
}
