//! Protocollo telnet: separa i dati dai comandi IAC e risponde alle negoziazioni.
//!
//! Il client accetta solo ECHO (il server nasconde l'input, es. password), SGA ed EOR
//! (segna la fine del prompt). Tutte le altre opzioni vengono rifiutate educatamente.
//! GA ed EOR diventano `Item::PromptEnd`: dicono dove finisce il prompt.

pub const IAC: u8 = 255;
pub const DONT: u8 = 254;
pub const DO: u8 = 253;
pub const WONT: u8 = 252;
pub const WILL: u8 = 251;
pub const SB: u8 = 250;
pub const GA: u8 = 249;
pub const SE: u8 = 240;
pub const EOR: u8 = 239;

pub const OPT_ECHO: u8 = 1;
pub const OPT_SGA: u8 = 3;
pub const OPT_EOR: u8 = 25;

/// Limite al contenuto di una sottonegoziazione (che comunque ignoriamo).
const MAX_SB: usize = 4096;

#[derive(Debug, PartialEq, Eq)]
pub enum Item {
    /// Byte di testo, già ripuliti dai comandi telnet.
    Data(Vec<u8>),
    /// GA o EOR: il testo arrivato finora senza `\n` è un prompt completo.
    PromptEnd,
    /// Il server gestisce l'eco (true) o lo restituisce al client (false).
    /// Quando è true l'input va nascosto: di solito è la password.
    ServerEcho(bool),
}

#[derive(Default, Clone, Copy)]
enum State {
    #[default]
    Data,
    Iac,
    Will,
    Wont,
    Do,
    Dont,
    Sb,
    SbIac,
}

#[derive(Default)]
pub struct Telnet {
    state: State,
    sb_len: usize,
    server_echo: bool,
    sga: bool,
    eor: bool,
    /// Risposte da mandare al server (negoziazioni).
    replies: Vec<u8>,
}

impl Telnet {
    pub fn new() -> Self {
        Self::default()
    }

    /// Restituisce e svuota le risposte accumulate per il server.
    pub fn take_replies(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.replies)
    }

    pub fn feed(&mut self, input: &[u8]) -> Vec<Item> {
        let mut out = Vec::new();
        let mut data = Vec::new();
        for &b in input {
            match self.state {
                State::Data => {
                    if b == IAC {
                        self.state = State::Iac;
                    } else {
                        data.push(b);
                    }
                }
                State::Iac => {
                    self.state = State::Data;
                    match b {
                        IAC => data.push(IAC),
                        GA | EOR => {
                            flush(&mut data, &mut out);
                            out.push(Item::PromptEnd);
                        }
                        WILL => self.state = State::Will,
                        WONT => self.state = State::Wont,
                        DO => self.state = State::Do,
                        DONT => self.state = State::Dont,
                        SB => {
                            self.sb_len = 0;
                            self.state = State::Sb;
                        }
                        _ => {} // NOP e altri comandi: ignorati
                    }
                }
                State::Will => {
                    self.state = State::Data;
                    self.on_will(b, &mut data, &mut out);
                }
                State::Wont => {
                    self.state = State::Data;
                    self.on_wont(b, &mut data, &mut out);
                }
                State::Do => {
                    self.state = State::Data;
                    // Non offriamo nessuna opzione lato client.
                    self.reply(WONT, b);
                }
                State::Dont => self.state = State::Data,
                State::Sb => {
                    if b == IAC {
                        self.state = State::SbIac;
                    } else {
                        self.sb_len += 1;
                        if self.sb_len > MAX_SB {
                            // Sottonegoziazione malformata: torniamo ai dati.
                            self.state = State::Data;
                        }
                    }
                }
                State::SbIac => {
                    self.state = if b == SE { State::Data } else { State::Sb };
                }
            }
        }
        flush(&mut data, &mut out);
        out
    }

    fn on_will(&mut self, opt: u8, data: &mut Vec<u8>, out: &mut Vec<Item>) {
        match opt {
            OPT_ECHO => {
                if !self.server_echo {
                    self.server_echo = true;
                    self.reply(DO, opt);
                    flush(data, out);
                    out.push(Item::ServerEcho(true));
                }
            }
            OPT_SGA => {
                if !self.sga {
                    self.sga = true;
                    self.reply(DO, opt);
                }
            }
            OPT_EOR => {
                if !self.eor {
                    self.eor = true;
                    self.reply(DO, opt);
                }
            }
            _ => self.reply(DONT, opt),
        }
    }

    fn on_wont(&mut self, opt: u8, data: &mut Vec<u8>, out: &mut Vec<Item>) {
        match opt {
            OPT_ECHO if self.server_echo => {
                self.server_echo = false;
                self.reply(DONT, opt);
                flush(data, out);
                out.push(Item::ServerEcho(false));
            }
            OPT_SGA if self.sga => {
                self.sga = false;
                self.reply(DONT, opt);
            }
            OPT_EOR if self.eor => {
                self.eor = false;
                self.reply(DONT, opt);
            }
            _ => {}
        }
    }

    fn reply(&mut self, cmd: u8, opt: u8) {
        self.replies.extend_from_slice(&[IAC, cmd, opt]);
    }
}

fn flush(data: &mut Vec<u8>, out: &mut Vec<Item>) {
    if !data.is_empty() {
        out.push(Item::Data(std::mem::take(data)));
    }
}

/// Prepara un testo da mandare al server: raddoppia i byte IAC e aggiunge `\r\n`.
pub fn encode_line(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(bytes.len() + 2);
    for &b in bytes {
        out.push(b);
        if b == IAC {
            out.push(IAC);
        }
    }
    out.extend_from_slice(b"\r\n");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn testo_semplice_passa_invariato() {
        let mut t = Telnet::new();
        assert_eq!(t.feed(b"ciao\n"), vec![Item::Data(b"ciao\n".to_vec())]);
        assert!(t.take_replies().is_empty());
    }

    #[test]
    fn iac_iac_diventa_un_byte_255() {
        let mut t = Telnet::new();
        assert_eq!(
            t.feed(&[b'a', IAC, IAC, b'b']),
            vec![Item::Data(vec![b'a', 255, b'b'])]
        );
    }

    #[test]
    fn ga_ed_eor_segnano_la_fine_del_prompt() {
        let mut t = Telnet::new();
        let items = t.feed(&[b'>', b'>', IAC, GA, b'x', IAC, EOR]);
        assert_eq!(
            items,
            vec![
                Item::Data(b">>".to_vec()),
                Item::PromptEnd,
                Item::Data(b"x".to_vec()),
                Item::PromptEnd
            ]
        );
    }

    #[test]
    fn will_echo_attiva_la_modalita_password_e_risponde_do() {
        let mut t = Telnet::new();
        let items = t.feed(&[b'P', b':', IAC, WILL, OPT_ECHO]);
        assert_eq!(
            items,
            vec![Item::Data(b"P:".to_vec()), Item::ServerEcho(true)]
        );
        assert_eq!(t.take_replies(), vec![IAC, DO, OPT_ECHO]);
        // Ripetuto: nessuna nuova risposta (niente cicli di negoziazione).
        assert!(t.feed(&[IAC, WILL, OPT_ECHO]).is_empty());
        assert!(t.take_replies().is_empty());
        let items = t.feed(&[IAC, WONT, OPT_ECHO]);
        assert_eq!(items, vec![Item::ServerEcho(false)]);
        assert_eq!(t.take_replies(), vec![IAC, DONT, OPT_ECHO]);
    }

    #[test]
    fn opzioni_non_supportate_vengono_rifiutate() {
        let mut t = Telnet::new();
        t.feed(&[IAC, DO, 31, IAC, WILL, 86]); // NAWS, MCCP2
        assert_eq!(t.take_replies(), vec![IAC, WONT, 31, IAC, DONT, 86]);
    }

    #[test]
    fn sottonegoziazione_ignorata() {
        let mut t = Telnet::new();
        let items = t.feed(&[b'a', IAC, SB, 24, 1, 2, IAC, SE, b'b']);
        assert_eq!(items, vec![Item::Data(b"ab".to_vec())]);
    }

    #[test]
    fn comando_spezzato_tra_due_pacchetti() {
        let mut t = Telnet::new();
        assert_eq!(t.feed(&[b'a', IAC]), vec![Item::Data(b"a".to_vec())]);
        assert_eq!(
            t.feed(&[GA, b'b']),
            vec![Item::PromptEnd, Item::Data(b"b".to_vec())]
        );
    }

    #[test]
    fn encode_line_raddoppia_iac_e_aggiunge_crlf() {
        assert_eq!(
            encode_line(&[b'a', IAC]),
            vec![b'a', IAC, IAC, b'\r', b'\n']
        );
    }
}
