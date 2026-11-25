//! Catena completa del testo in ingresso: byte → telnet → decodifica → righe → span ANSI.
//! È pura (niente rete): la usano la connessione vera, il replay e i test.

use serde::Serialize;

use crate::ansi::{AnsiParser, Span};
use crate::decode::{Decoder, Encoding};
use crate::lines::LineAssembler;
use crate::telnet::{Item, Telnet};

/// Una riga pronta per il frontend, con il testo grezzo (codici ANSI inclusi) per il log.
#[derive(Debug, Clone)]
pub struct RawLine {
    pub raw: String,
    pub spans: Vec<Span>,
    pub partial: bool,
}

#[derive(Debug)]
pub enum Output {
    Line(RawLine),
    ServerEcho(bool),
}

pub struct Pipeline {
    telnet: Telnet,
    decoder: Decoder,
    lines: LineAssembler,
    ansi: AnsiParser,
    prompt_ends: u64,
}

impl Pipeline {
    pub fn new(encoding: Encoding) -> Self {
        Self {
            telnet: Telnet::new(),
            decoder: Decoder::new(encoding),
            lines: LineAssembler::new(),
            ansi: AnsiParser::new(),
            prompt_ends: 0,
        }
    }

    /// Elabora i byte ricevuti. Le risposte telnet si prendono con `take_replies`.
    pub fn feed(&mut self, bytes: &[u8]) -> Vec<Output> {
        let mut out = Vec::new();
        for item in self.telnet.feed(bytes) {
            match item {
                Item::Data(data) => {
                    let text = self.decoder.decode(&data);
                    for raw in self.lines.push(&text) {
                        out.push(Output::Line(self.line(raw, false)));
                    }
                }
                Item::PromptEnd => {
                    self.prompt_ends += 1;
                    out.extend(self.flush_partial());
                }
                Item::ServerEcho(on) => out.push(Output::ServerEcho(on)),
            }
        }
        out
    }

    pub fn take_replies(&mut self) -> Vec<u8> {
        self.telnet.take_replies()
    }

    /// Quanti GA/EOR ha mandato il server finora (diagnostica: dice se il prompt è segnalato).
    pub fn prompt_ends(&self) -> u64 {
        self.prompt_ends
    }

    pub fn has_partial(&self) -> bool {
        self.lines.has_partial()
    }

    /// Consegna la riga parziale (dopo GA/EOR o dopo il timeout).
    pub fn flush_partial(&mut self) -> Vec<Output> {
        // I byte in attesa nel decoder sono solo sequenze UTF-8 incomplete (mai `\n`),
        // ma passano comunque dall'assemblatore per non perdere nulla.
        let rest = self.decoder.flush();
        let mut out: Vec<Output> = self
            .lines
            .push(&rest)
            .into_iter()
            .map(|raw| Output::Line(self.line(raw, false)))
            .collect();
        if let Some(raw) = self.lines.take_partial() {
            out.push(Output::Line(self.line(raw, true)));
        }
        out
    }

    /// Converte una riga già decodificata (usato anche dal replay).
    pub fn line(&mut self, raw: String, partial: bool) -> RawLine {
        let spans = self.ansi.parse_line(&raw);
        RawLine {
            raw,
            spans,
            partial,
        }
    }

    pub fn encode(&self, text: &str) -> Vec<u8> {
        crate::telnet::encode_line(&self.decoder.encode(text))
    }
}

/// Riga come la riceve il frontend.
#[derive(Serialize, Clone, Debug)]
pub struct WireLine {
    pub spans: Vec<Span>,
    pub partial: bool,
}

impl From<RawLine> for WireLine {
    fn from(l: RawLine) -> Self {
        Self {
            spans: l.spans,
            partial: l.partial,
        }
    }
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ConnState {
    Connecting,
    Connected,
    Disconnected,
    Replay,
    ReplayEnded,
}

/// Eventi mandati al frontend sul canale della connessione o del replay.
#[derive(Serialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ServerEvent {
    /// Righe arrivate insieme (raggruppate per non intasare il canale).
    Lines {
        lines: Vec<WireLine>,
    },
    /// Il server nasconde l'input (password) o lo rende di nuovo visibile.
    ServerEcho {
        on: bool,
    },
    Status {
        state: ConnState,
        message: String,
    },
    /// Comando registrato in un log (solo replay).
    Echo {
        text: String,
    },
    Error {
        message: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::telnet::{GA, IAC, OPT_ECHO, WILL};

    fn texts(out: &[Output]) -> Vec<(String, bool)> {
        out.iter()
            .filter_map(|o| match o {
                Output::Line(l) => {
                    Some((l.spans.iter().map(|s| s.text.as_str()).collect(), l.partial))
                }
                _ => None,
            })
            .collect()
    }

    #[test]
    fn prompt_con_ga_consegnato_come_parziale() {
        let mut p = Pipeline::new(Encoding::Utf8);
        let mut bytes = b"Uscite: Nord\r\nRigel H481 M493 V247 X-28602993 [T] */*>> ".to_vec();
        bytes.extend_from_slice(&[IAC, GA]);
        let out = p.feed(&bytes);
        assert_eq!(
            texts(&out),
            vec![
                ("Uscite: Nord".into(), false),
                (
                    "Rigel H481 M493 V247 X-28602993 [T] */*>> ".into(),
                    true
                )
            ]
        );
        assert!(!p.has_partial());
        assert_eq!(p.prompt_ends(), 1);
    }

    #[test]
    fn senza_ga_il_prompt_resta_in_attesa_fino_al_flush() {
        let mut p = Pipeline::new(Encoding::Utf8);
        assert!(texts(&p.feed(b"X H1 M2 V3 X4>> ")).is_empty());
        assert!(p.has_partial());
        let out = p.flush_partial();
        assert_eq!(texts(&out), vec![("X H1 M2 V3 X4>> ".into(), true)]);
    }

    #[test]
    fn password_e_risposta_telnet() {
        let mut p = Pipeline::new(Encoding::Utf8);
        let out = p.feed(&[IAC, WILL, OPT_ECHO]);
        assert!(matches!(out[..], [Output::ServerEcho(true)]));
        assert!(!p.take_replies().is_empty());
    }

    #[test]
    fn evento_serializzato_per_il_frontend() {
        let ev = ServerEvent::Status {
            state: ConnState::ReplayEnded,
            message: "fine".into(),
        };
        let json = serde_json::to_string(&ev).unwrap();
        assert_eq!(
            json,
            r#"{"type":"status","state":"replayEnded","message":"fine"}"#
        );
        let ev = ServerEvent::ServerEcho { on: true };
        assert_eq!(
            serde_json::to_string(&ev).unwrap(),
            r#"{"type":"serverEcho","on":true}"#
        );
    }
}
