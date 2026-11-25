//! Decodifica dei caratteri. In UTF-8 i byte non validi vengono letti come ISO-8859-1,
//! così funzionano sia i testi UTF-8 sia quelli Latin-1 (accenti di vecchi MUD).
//! Le sequenze UTF-8 spezzate tra due pacchetti vengono tenute da parte.

use serde::Deserialize;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Encoding {
    #[default]
    Utf8,
    Latin1,
}

#[derive(Default)]
pub struct Decoder {
    encoding: Encoding,
    pending: Vec<u8>,
}

impl Decoder {
    pub fn new(encoding: Encoding) -> Self {
        Self {
            encoding,
            pending: Vec::new(),
        }
    }

    pub fn decode(&mut self, input: &[u8]) -> String {
        match self.encoding {
            Encoding::Latin1 => input.iter().map(|&b| b as char).collect(),
            Encoding::Utf8 => {
                let mut buf = std::mem::take(&mut self.pending);
                buf.extend_from_slice(input);
                let mut out = String::with_capacity(buf.len());
                let mut rest = &buf[..];
                loop {
                    match std::str::from_utf8(rest) {
                        Ok(s) => {
                            out.push_str(s);
                            break;
                        }
                        Err(e) => {
                            let (valid, after) = rest.split_at(e.valid_up_to());
                            // `valid` è UTF-8 valido per costruzione.
                            out.push_str(std::str::from_utf8(valid).unwrap_or_default());
                            match e.error_len() {
                                Some(n) => {
                                    out.extend(after[..n].iter().map(|&b| b as char));
                                    rest = &after[n..];
                                }
                                None => {
                                    // Sequenza incompleta in fondo: aspetta il resto.
                                    self.pending = after.to_vec();
                                    break;
                                }
                            }
                        }
                    }
                }
                out
            }
        }
    }

    /// Svuota i byte in attesa leggendoli come Latin-1 (usato quando il flusso si ferma).
    pub fn flush(&mut self) -> String {
        std::mem::take(&mut self.pending)
            .into_iter()
            .map(|b| b as char)
            .collect()
    }

    pub fn encode(&self, text: &str) -> Vec<u8> {
        match self.encoding {
            Encoding::Utf8 => text.as_bytes().to_vec(),
            Encoding::Latin1 => text
                .chars()
                .map(|c| u8::try_from(u32::from(c)).unwrap_or(b'?'))
                .collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf8_valido() {
        let mut d = Decoder::new(Encoding::Utf8);
        assert_eq!(d.decode("così più".as_bytes()), "così più");
    }

    #[test]
    fn byte_latin1_in_flusso_utf8() {
        let mut d = Decoder::new(Encoding::Utf8);
        // "piè" in Latin-1: 0xE8 non è UTF-8 valido seguito da ASCII.
        assert_eq!(d.decode(&[b'p', b'i', 0xE8, b'!']), "piè!");
    }

    #[test]
    fn sequenza_utf8_spezzata_tra_pacchetti() {
        let mut d = Decoder::new(Encoding::Utf8);
        let bytes = "è".as_bytes(); // [0xC3, 0xA8]
        assert_eq!(d.decode(&[b'a', bytes[0]]), "a");
        assert_eq!(d.decode(&[bytes[1], b'b']), "èb");
    }

    #[test]
    fn flush_svuota_i_byte_in_attesa() {
        let mut d = Decoder::new(Encoding::Utf8);
        assert_eq!(d.decode(&[b'x', 0xE8]), "x");
        assert_eq!(d.flush(), "è");
    }

    #[test]
    fn latin1_puro() {
        let mut d = Decoder::new(Encoding::Latin1);
        assert_eq!(d.decode(&[0xE0, 0xF9]), "àù");
        assert_eq!(
            d.encode("città €"),
            vec![b'c', b'i', b't', b't', 0xE0, b' ', b'?']
        );
    }
}
